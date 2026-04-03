import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
  PaymentMethod,
} from '../entities/subscription.entity';
import { Package, DurationType } from '../entities/package.entity';
import { User } from '../entities/user.entity';
import { Router } from '../entities/router.entity';
import { DeviceSession } from '../entities/device-session.entity';
import { MikrotikService } from '../routers/mikrotik.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionMethod } from '../entities/transaction.entity';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    @InjectRepository(Package) private pkgRepo: Repository<Package>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Router) private routerRepo: Repository<Router>,
    @InjectRepository(DeviceSession)
    private sessionRepo: Repository<DeviceSession>,
    private mikrotikService: MikrotikService,
    private transactionsService: TransactionsService,
  ) {}

  /**
   * Sync Device: Finds the user's MAC by querying the router's hotspot host table.
   * Since the VPS sees the router's public IP (NAT), we can't search by client IP.
   * Instead, we get ALL hosts from the user's associated router and filter out
   * MACs that are already bound to active sessions.
   */
  async syncDevice(userId: string): Promise<{ mac: string; ip: string }> {
    this.logger.log(`[SYNC] Attempting to sync device for user ${userId}`);

    // Step 1: Find the user's most recent subscription to determine which router to query
    const userSub = await this.subRepo.findOne({
      where: { user: { id: userId } },
      relations: ['router'],
      order: { createdAt: 'DESC' },
    });

    if (!userSub?.router) {
      throw new BadRequestException('No subscription found. Purchase a package first.');
    }

    const router = userSub.router;
    this.logger.log(`[SYNC] Using router: ${router.name} (${router.host})`);

    // Step 2: Get ALL hosts currently on the router's hotspot
    const allHosts = await this.mikrotikService.getAllHosts(router);
    if (allHosts.length === 0) {
      throw new BadRequestException(
        'No devices detected on the Wi-Fi network. Make sure you are connected to the hotspot.'
      );
    }

    this.logger.log(`[SYNC] Found ${allHosts.length} hosts on ${router.name}: ${allHosts.map(h => h.mac).join(', ')}`);

    // Step 3: Get all MACs that are already bound to active device sessions
    const activeSessions = await this.sessionRepo.find({
      where: { isActive: true },
      relations: ['subscription', 'subscription.user'],
    });
    const boundMacs = new Set(
      activeSessions
        .map(s => s.macAddress?.toUpperCase())
        .filter(Boolean)
    );

    // Step 4: Filter out already-bound hosts
    const available = allHosts.filter(h => !boundMacs.has(h.mac.toUpperCase()));

    if (available.length === 0) {
      // If all hosts are bound, maybe the user's own device IS one of the bound ones
      // Try to find this user's own session MAC
      const ownSession = activeSessions.find(s => s.subscription?.user?.id === userId);
      if (ownSession?.macAddress) {
        const ownHost = allHosts.find(h => h.mac.toUpperCase() === ownSession.macAddress.toUpperCase());
        if (ownHost) return ownHost;
      }
      throw new BadRequestException(
        'All detected devices already have active sessions. Disconnect other devices or try again.'
      );
    }

    // Step 5: If only one available host, auto-assign it
    if (available.length === 1) {
      this.logger.log(`[SYNC] Auto-assigned MAC: ${available[0].mac}`);
      return available[0];
    }

    // Step 6: Multiple available hosts — return the first one (most recent)
    // In practice, for small hotspots this is usually correct
    this.logger.log(`[SYNC] Multiple available hosts (${available.length}), picking first: ${available[0].mac}`);
    return available[0];
  }


  async purchase(
    userId: string,
    packageId: string,
    routerId?: string,
  ): Promise<Subscription> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const pkg = await this.pkgRepo.findOne({
      where: { id: packageId, isActive: true },
    });
    if (!pkg) throw new NotFoundException('Package not found or inactive');

    // Auto-resolve router if none provided
    let router;
    if (routerId) {
      router = await this.routerRepo.findOne({ where: { id: routerId, isOnline: true } });
    }
    if (!router) {
      router = await this.routerRepo.findOne({ where: { isOnline: true } });
    }
    if (!router) throw new NotFoundException('No router available or online');

    const sub = this.subRepo.create({
      user,
      package: pkg,
      router,
      status: SubscriptionStatus.PENDING,
      amountPaid: pkg.price,
      paymentMethod: PaymentMethod.MANUAL,
    });

    return this.subRepo.save(sub);
  }

  async activate(
    subId: string,
    paymentMethod: PaymentMethod,
    paymentRef?: string,
  ): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.PENDING) {
      throw new BadRequestException(`Subscription is in ${sub.status} state`);
    }

    // Connect to Mikrotik
    const username = `net_${sub.user.phone.substring(sub.user.phone.length - 6)}_${Date.now().toString().substring(7)}`;
    const password = Math.random().toString(36).slice(-6);

    try {
      if (sub.router.connectionMode === 'pppoe') {
        await this.mikrotikService.createPppoeSecret(
          sub.router,
          username,
          password,
          sub.package.bandwidthProfile,
        );
      } else {
        await this.mikrotikService.createHotspotUser(
          sub.router,
          username,
          password,
          sub.package.bandwidthProfile,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Activation failed for sub ${subId}: ${error.message || JSON.stringify(error)}`,
      );
      throw new BadRequestException(
        `MikroTik Error: ${error.message || JSON.stringify(error)}`,
      );
    }

    sub.status = SubscriptionStatus.ACTIVE;
    sub.paymentMethod = paymentMethod;
    sub.paymentRef = paymentRef || '';
    sub.mikrotikUsername = username;
    sub.mikrotikPassword = password;
    sub.startedAt = null;
    sub.expiresAt = null;

    const savedSub = await this.subRepo.save(sub);

    // Log transaction
    let txMethod = TransactionMethod.MANUAL;
    if (paymentMethod === PaymentMethod.MPESA)
      txMethod = TransactionMethod.MPESA_STK;
    if (paymentMethod === PaymentMethod.VOUCHER)
      txMethod = TransactionMethod.VOUCHER;

    await this.transactionsService.log({
      user: sub.user,
      package: sub.package,
      amount: sub.amountPaid,
      method: txMethod,
      reference: paymentRef,
      notes:
        paymentMethod === PaymentMethod.MANUAL
          ? 'Administrator manual allocation'
          : undefined,
    });

    return savedSub;
  }

  async findMy(userId: string): Promise<Subscription[]> {
    return this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'user', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });
  }

  async findActive(userId: string): Promise<Subscription | null> {
    const all = await this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'user', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });
    return all.find(sub => sub.status?.toString().toLowerCase() === 'active') || null;
  }

  async findRecent(userId: string): Promise<any | null> {
    // Priority 1: Specifically Active and not expired
    const all = await this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'user', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });
    const active = all.find(sub => sub.status?.toString().toLowerCase() === 'active');

    if (
      active &&
      (!active.expiresAt || new Date(active.expiresAt) > new Date())
    ) {
      return { ...active, isActive: true };
    }

    // Priority 2: Absolute most recent regardless of status
    const recent = all[0];

    if (!recent) return null;

    const isActive =
      recent.status?.toString().toLowerCase() === 'active' &&
      (!recent.expiresAt || new Date(recent.expiresAt) > new Date());
    return { ...recent, isActive };
  }

  async findAllActive(userId: string): Promise<Subscription[]> {
    this.logger.log(`[DIAGNOSTIC] findAllActive for ${userId} - Starting RELIABLE Query...`);
    
    const all = await this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });

    this.logger.log(`[DIAGNOSTIC] Found ${all.length} raw subs for user ${userId}.`);

    const filtered = all.filter((sub) => {
      const status = sub.status?.toString().toLowerCase().trim();
      
      // Even more robust check: If it's physically active or explicitly allocated/pending
      const isActionable = ['active', 'pending', 'paid', 'verified', 'processing', 'allocated'].includes(status);
      
      const isExpired = sub.expiresAt && new Date(sub.expiresAt) < new Date();
      
      // If it's active but expired, we still return it so the UI can show "EXPIRED" properly in the active section if needed,
      // but primarily we want to ensure 'active' and 'allocated' are NEVER hidden.
      this.logger.log(`[DIAGNOSTIC] Sub ${sub.id} | Status: ${status} | Expired: ${isExpired} | Actionable: ${isActionable}`);
      
      return isActionable;
    });

    this.logger.log(`[DIAGNOSTIC] Final Actionable Count: ${filtered.length}`);
    return filtered;
  }

  async findAll(): Promise<Subscription[]> {
    return this.subRepo.find({
      relations: ['package', 'router', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async countPending(): Promise<number> {
    return this.subRepo.count({
      where: { status: SubscriptionStatus.PENDING },
    });
  }

  async activatePendingByPhone(
    phone: string,
    paymentMethod: PaymentMethod,
    paymentRef?: string,
  ): Promise<Subscription> {
    const phoneSuffix =
      phone.length > 9 ? phone.substring(phone.length - 9) : phone;

    const sub = await this.subRepo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.user', 'user')
      .leftJoinAndSelect('sub.package', 'package')
      .leftJoinAndSelect('sub.router', 'router')
      .where('user.phone LIKE :phone', { phone: `%${phoneSuffix}` })
      .andWhere('sub.status = :status', { status: SubscriptionStatus.PENDING })
      .orderBy('sub.createdAt', 'DESC')
      .getOne();

    if (!sub) {
      this.logger.warn(
        `Webhook received for ${phone} but no pending subscription found.`,
      );
      throw new NotFoundException('No pending subscription found for phone');
    }

    return this.activate(sub.id, paymentMethod, paymentRef);
  }

  async allocate(
    userId: string,
    packageId: string,
    routerId: string,
  ): Promise<Subscription> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const pkg = await this.pkgRepo.findOne({
      where: { id: packageId, isActive: true },
    });
    if (!pkg) throw new NotFoundException('Package not found or inactive');

    const router = await this.routerRepo.findOne({
      where: { id: routerId, isOnline: true },
    });
    if (!router) throw new NotFoundException('Router not found or offline');

    // Create
    const sub = this.subRepo.create({
      user,
      package: pkg,
      router,
      status: SubscriptionStatus.PENDING,
      amountPaid: pkg.price,
      paymentMethod: PaymentMethod.MANUAL,
    });
    const saved = await this.subRepo.save(sub);

    // Activate immediately
    return this.activate(saved.id, PaymentMethod.MANUAL, 'admin-allocated');
  }

  async expireSubscription(subId: string): Promise<void> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['router'],
    });
    if (!sub) return;

    if (sub.mikrotikUsername) {
      try {
        if (sub.router.connectionMode === 'pppoe') {
          await this.mikrotikService.removePppoeSecret(
            sub.router,
            sub.mikrotikUsername,
          );
        } else {
          await this.mikrotikService.removeHotspotUser(
            sub.router,
            sub.mikrotikUsername,
          );
        }
      } catch (e) {
        this.logger.error(
          `Failed to remove user from router on expire for sub ${subId}. Aborting expiry to retry.`,
          e,
        );
        throw e; // Rethrow to prevent marking as EXPIRED in DB
      }
    }

    sub.status = SubscriptionStatus.EXPIRED;
    await this.subRepo.save(sub);
  }

  async cancelSubscription(subId: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot cancel a subscription in ${sub.status} state`,
      );
    }

    // Remove from MikroTik
    if (sub.mikrotikUsername) {
      try {
        if (sub.router.connectionMode === 'pppoe') {
          await this.mikrotikService.removePppoeSecret(
            sub.router,
            sub.mikrotikUsername,
          );
        } else {
          await this.mikrotikService.removeHotspotUser(
            sub.router,
            sub.mikrotikUsername,
          );
        }
      } catch (e) {
        this.logger.warn(
          `MikroTik cleanup failed for sub ${subId}: ${e.message}`,
        );
      }
    }

    sub.status = SubscriptionStatus.CANCELLED;
    return this.subRepo.save(sub);
  }

  async reactivateSubscription(subId: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.CANCELLED) {
      throw new BadRequestException(
        `Can only reactivate a cancelled subscription, current state: ${sub.status}`,
      );
    }

    // Reset status to pending so the user can activate it when they are physically connected
    sub.status = SubscriptionStatus.PENDING;
    sub.startedAt = null;
    sub.expiresAt = null;

    return this.subRepo.save(sub);
  }

  private parseUserAgent(ua: string): string {
    if (!ua) return 'Unknown Device';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) {
      const match = ua.match(/Android\s[0-9.]+;\s([^;]+)/);
      return match ? match[1] : 'Android Device';
    }
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Macintosh/.test(ua)) return 'MacBook';
    return 'Generic Device';
  }

  /**
   * Disconnect a specific device session — deactivates the session record
   * and removes the device from the MikroTik router's active/host tables.
   */
  async disconnectDevice(userId: string, sessionId: string): Promise<{ success: boolean; message: string }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['subscription', 'subscription.user', 'subscription.router'],
    });

    if (!session) throw new NotFoundException('Device session not found');
    if (session.subscription?.user?.id !== userId) {
      throw new BadRequestException('You can only disconnect your own devices');
    }

    // Deactivate session
    session.isActive = false;
    await this.sessionRepo.save(session);

    // Remove from router if possible
    if (session.subscription.router && session.macAddress) {
      try {
        const router = session.subscription.router;
        const api = await (this.mikrotikService as any).connect(router);
        try {
          // Remove from hotspot active sessions by MAC
          const active = await api.write('/ip/hotspot/active/print', [
            `?mac-address=${session.macAddress}`,
          ]);
          for (const a of active) {
            await api.write('/ip/hotspot/active/remove', [`=.id=${a['.id']}`]);
          }
          // Remove from host table
          const hosts = await api.write('/ip/hotspot/host/print', [
            `?mac-address=${session.macAddress}`,
          ]);
          for (const h of hosts) {
            await api.write('/ip/hotspot/host/remove', [`=.id=${h['.id']}`]);
          }
          this.logger.log(`[DISCONNECT] Removed device ${session.macAddress} from router ${router.name}`);
        } finally {
          api.close();
        }
      } catch (e) {
        this.logger.warn(`[DISCONNECT] Router cleanup failed for ${session.macAddress}: ${e.message}`);
      }
    }

    return { success: true, message: `Device ${session.deviceModel || session.macAddress} disconnected` };
  }

  async startSession(
    id: string,
    mac?: string,
    ip?: string,
    userAgent?: string,
  ): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['user', 'package', 'router', 'deviceSessions'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');

    // Capture and Save Device Model if missing
    const model = userAgent ? this.parseUserAgent(userAgent) : 'Unknown Device';

    if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.PENDING) {
      throw new BadRequestException(
        `Subscription is in ${sub.status} state, cannot start`,
      );
    }

    // VERIFY PHYSICAL CONNECTION TO AP
    const finalMac = mac || sub.user.lastMac;
    const finalIp = ip || sub.user.lastIp;

    if (finalMac || finalIp) {
      const isPresent = await this.mikrotikService.verifyHostPresence(sub.router, finalMac, finalIp);
      if (!isPresent) {
        throw new BadRequestException(
          'CONNECTION REJECTED: You are not physically connected to the hotspot Wi-Fi network. Please connect to the Wi-Fi first to activate this package.',
        );
      }
    } else {
      throw new BadRequestException(
        'Missing MAC and IP address bindings to assign this package to.',
      );
    }

    // SEQUENTIAL CHECK: Check if any OTHER subscription is already live
    const allSubs = await this.findAllActive(sub.user.id);
    const liveSub = allSubs.find(
      (s) =>
        s.id !== id &&
        s.startedAt &&
        s.expiresAt &&
        new Date(s.expiresAt) > new Date(),
    );

    if (liveSub) {
      throw new BadRequestException(
        `CONFLICT: You already have a live session (${liveSub.package?.name}). You must wait for it to expire before starting a new one.`,
      );
    }

    // MULTI-DEVICE LOGIC
    if (mac) {
      const existingSession = sub.deviceSessions?.find(
        (s) => s.macAddress === mac,
      );

      if (!existingSession) {
        // Check Limit
        const activeDeviceCount =
          sub.deviceSessions?.filter((s) => s.isActive).length || 0;
        const maxAllowed = sub.package.maxDevices || 1;

        if (activeDeviceCount >= maxAllowed) {
          const connectedDevices = sub.deviceSessions
            .filter(s => s.isActive)
            .map(s => ({
              id: s.id,
              mac: s.macAddress,
              ip: s.ipAddress,
              model: s.deviceModel || 'Unknown Device',
              connectedAt: s.createdAt,
            }));

          const err: any = new BadRequestException({
            statusCode: 400,
            error: 'DEVICE_LIMIT_REACHED',
            message: `This package supports ${maxAllowed} device(s). Disconnect one to connect this device.`,
            maxDevices: maxAllowed,
            connectedDevices,
          });
          throw err;
        }

        // Create new session
        const newSession = this.sessionRepo.create({
          subscription: sub,
          macAddress: mac,
          ipAddress: ip,
          deviceModel: model,
          isActive: true,
        });
        await this.sessionRepo.save(newSession);
      } else {
        // Update existing session
        existingSession.ipAddress = ip || existingSession.ipAddress;
        existingSession.deviceModel = model;
        existingSession.isActive = true;
        await this.sessionRepo.save(existingSession);
      }
    }

    // 2. ALWAYS attempt login on MikroTik
    if (finalMac || finalIp) {
      try {
        await this.mikrotikService.loginUser(
          sub.router,
          sub.mikrotikUsername,
          sub.mikrotikPassword,
          finalIp,
          finalMac,
          sub.package.bandwidthProfile,
        );
      } catch (e) {
        this.logger.error(`Router Login Failed: ${e.message}`);
      }
    }

    // 3. Mark subscription as STARTED if first time
    if (!sub.startedAt) {
      sub.startedAt = new Date();
      sub.status = SubscriptionStatus.ACTIVE;

      // Calculate expiry
      const duration = sub.package.durationValue;
      const type = sub.package.durationType;
      const expiresAt = new Date(sub.startedAt);
      if (type === 'minutes')
        expiresAt.setMinutes(expiresAt.getMinutes() + duration);
      else if (type === 'hours')
        expiresAt.setHours(expiresAt.getHours() + duration);
      else if (type === 'days')
        expiresAt.setDate(expiresAt.getDate() + duration);
      sub.expiresAt = expiresAt;
    }

    return this.subRepo.save(sub);
  }

  async getTrafficStats(userId: string): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { user: { id: userId }, status: 'active' as any },
      relations: ['router', 'user'],
    });

    if (!sub || !sub.router.isOnline) return null;

    try {
      const stats = await this.mikrotikService.getUserTraffic(
        sub.router,
        sub.mikrotikUsername,
        sub.user.lastIp,
        sub.user.lastMac,
      );
      return stats;
    } catch (e) {
      return null;
    }
  }

  async getTrafficForSub(subId: string): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { id: subId, status: 'active' as any },
      relations: ['router', 'user'],
    });

    if (!sub || !sub.router.isOnline) return null;

    try {
      const stats = await this.mikrotikService.getUserTraffic(
        sub.router,
        sub.mikrotikUsername,
        sub.user.lastIp,
        sub.user.lastMac,
      );
      return stats;
    } catch (e) {
      return null;
    }
  }
}
