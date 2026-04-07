import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { MpesaService } from './mpesa.service';

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
    private mpesaService: MpesaService,
    private transactionsService: TransactionsService,
  ) {}

  /**
   * Sync Device: Finds the user's MAC by querying the router's hotspot host table.
   * Since the VPS sees the router's public IP (NAT), we can't search by client IP.
   * Instead, we get ALL hosts from the user's associated router and filter out
   * MACs that are already bound to active sessions.
   */
  async syncDevice(userId: string, clientIp: string): Promise<{ mac: string; ip: string }> {
    this.logger.log(`[SYNC] Syncing device for user ${userId} | Client IP: ${clientIp}`);

    const userSub = await this.subRepo.findOne({
      where: { user: { id: userId } },
      relations: ['router', 'package'],
      order: { createdAt: 'DESC' },
    });

    if (!userSub?.router) {
      throw new BadRequestException('No subscription found. Purchase a package first.');
    }

    const router = userSub.router;
    const allHosts = await this.mikrotikService.getAllHosts(router);
    
    // 1. Try to find the host matching the client's current IP
    const host = allHosts.find(h => h.ip === clientIp);
    if (host) {
      this.logger.log(`[SYNC] Found host by IP: ${host.mac} (${host.ip})`);
      return host;
    }

    // Fallback: If IP not found directly (e.g. NAT), check if this user ALREADY has an active session on this router
    const mySessions = await this.sessionRepo.find({
      where: { subscription: { user: { id: userId } }, isActive: true },
      relations: ['subscription', 'subscription.router'],
    });

    if (mySessions.length > 0) {
      const activeMacs = mySessions.map(s => s.macAddress?.toUpperCase()).filter(Boolean);
      const existingHost = allHosts.find(h => activeMacs.includes(h.mac?.toUpperCase()));
      if (existingHost) {
        this.logger.log(`[SYNC] Resuming existing host for user: ${existingHost.mac}`);
        return existingHost;
      }
    }

    this.logger.warn(`[SYNC] Device with IP ${clientIp} not found on router ${router.name}`);
    throw new BadRequestException(
      'Could not find your device on the hotspot Wi-Fi. Make sure you are connected to the hotspot and visit the login page first.',
    );
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
      status: SubscriptionStatus.AWAITING_APPROVAL, // Default to awaiting approval for manual requests
      amountPaid: pkg.price,
      paymentMethod: PaymentMethod.MANUAL,
    });

    return this.subRepo.save(sub);
  }

  async getStatus(subId: string): Promise<{ status: SubscriptionStatus }> {
    const sub = await this.subRepo.findOne({ where: { id: subId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    return { status: sub.status };
  }

  async setStatus(subId: string, status: SubscriptionStatus): Promise<Subscription> {
    const sub = await this.subRepo.findOne({ where: { id: subId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    sub.status = status;
    return this.subRepo.save(sub);
  }

  async updateMpesaCheckoutId(subId: string, checkoutId: string): Promise<void> {
    await this.subRepo.update(subId, { mpesaCheckoutId: checkoutId });
  }

  async checkStkStatus(subId: string): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (!sub.mpesaCheckoutId) {
      throw new BadRequestException('No M-Pesa transaction ID found for this subscription');
    }

    try {
      const result = await this.mpesaService.queryStkStatus(sub.mpesaCheckoutId);
      this.logger.log(`[STK QUERY] Sub ${subId} Result: ${result.ResultCode} - ${result.ResultDesc}`);

      // ResultCode "0" means Success
      if (result.ResultCode === '0') {
        await this.activate(sub.id, PaymentMethod.MPESA, `STK-${sub.mpesaCheckoutId.substring(0, 10)}`);
        return { success: true, status: SubscriptionStatus.PAID, result };
      } 
      
      // ResultCode "1032" means Cancelled by User
      if (result.ResultCode === '1032') {
        sub.status = SubscriptionStatus.PENDING; 
        await this.subRepo.save(sub);
        return { success: false, status: SubscriptionStatus.PENDING, cancelled: true, result };
      }

      // Other codes (Timeout, etc)
      return { success: false, status: sub.status, result };
    } catch (e: any) {
      this.logger.error(`STK Status Query failed for ${subId}: ${e.message}`);
      throw e;
    }
  }

  async delete(subId: string, userId?: string): Promise<void> {
    const where: any = { id: subId };
    if (userId) where.user = { id: userId };

    const sub = await this.subRepo.findOne({ where });
    if (!sub) throw new NotFoundException('Subscription not found');

    if (
      sub.status !== SubscriptionStatus.PENDING &&
      sub.status !== SubscriptionStatus.AWAITING_APPROVAL &&
      sub.status !== SubscriptionStatus.VERIFYING
    ) {
      throw new BadRequestException('Can only delete unapproved or pending requests');
    }

    await this.subRepo.remove(sub);
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
    if (
      sub.status !== SubscriptionStatus.PENDING &&
      sub.status !== SubscriptionStatus.AWAITING_APPROVAL &&
      sub.status !== SubscriptionStatus.VERIFYING
    ) {
      throw new BadRequestException(`Subscription is in ${sub.status} state`);
    }

    // PAYMENT CONFIRMED: Mark as PAID, but don't provision yet (Lazy Provisioning)
    sub.status = SubscriptionStatus.PAID;
    sub.paymentMethod = paymentMethod;
    sub.paymentRef = paymentRef || '';
    // Generate credentials now, but don't send to router until startSession
    sub.mikrotikUsername = `net_${sub.user.phone.substring(sub.user.phone.length - 6)}_${Date.now().toString().substring(7)}`;
    sub.mikrotikPassword = Math.random().toString(36).slice(-6);
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
      const isActionable = ['active', 'paid', 'pending', 'verified', 'processing', 'allocated', 'awaiting_approval', 'verifying'].includes(status);
      
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
      .andWhere('sub.status IN (:...statuses)', { statuses: [SubscriptionStatus.PENDING, SubscriptionStatus.VERIFYING] })
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
      relations: ['router', 'deviceSessions'],
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

    // Forced hardware logout for all associated devices to trigger captive portal popup
    if (sub.deviceSessions && sub.deviceSessions.length > 0) {
      for (const session of sub.deviceSessions) {
        try {
          await this.mikrotikService.forceLogoutHotspot(
            sub.router,
            session.ipAddress,
            session.macAddress,
            sub.mikrotikUsername,
          );
        } catch (e) {
          this.logger.warn(`Secondary hardware logout failed for ${session.macAddress}: ${e.message}`);
        }
      }
    }

    sub.status = SubscriptionStatus.EXPIRED;
    await this.subRepo.save(sub);
  }

  async cancelSubscription(subId: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router', 'deviceSessions'],
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

    // Force hardware logout for all associated devices
    if (sub.deviceSessions && sub.deviceSessions.length > 0) {
      for (const session of sub.deviceSessions) {
        try {
          await this.mikrotikService.forceLogoutHotspot(
            sub.router,
            session.ipAddress,
            session.macAddress,
          );
        } catch (e) {
          this.logger.warn(`Hardware logout failed for session ${session.id}: ${e.message}`);
        }
      }
    }

    sub.status = SubscriptionStatus.CANCELLED;
    return this.subRepo.save(sub);
  }

  async reactivateSubscription(subId: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router', 'deviceSessions'],
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
        
        // FORCE LOGOUT: This is the critical step to trigger the captive portal on the device
        await this.mikrotikService.forceLogoutHotspot(
          router,
          session.ipAddress,
          session.macAddress,
          session.subscription.mikrotikUsername,
        );
        
        this.logger.log(`[DISCONNECT] Forcefully removed device ${session.macAddress} from router ${router.name}`);
      } catch (e) {
        this.logger.warn(`[DISCONNECT] Router cleanup failed for ${session.macAddress}: ${e.message}`);
      }
    }

    return { success: true, message: `Device ${session.deviceModel || session.macAddress} disconnected` };
  }

  /**
   * Discovery Scanner: Fetches all active hosts on the router
   * and filters out those already linked to other user sessions.
   */
  async discoverNearbyHosts(subId: string): Promise<Array<{ mac: string; ip: string; deviceName?: string }>> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['router'],
    });

    if (!sub || !sub.router) throw new NotFoundException('Subscription or Router not found');

    // 1. Get all hardware hosts from MikroTik
    const allHosts = await this.mikrotikService.getAllHosts(sub.router);
    if (!allHosts || allHosts.length === 0) return [];

    // 2. Get all currently linked active sessions to filter them out
    const activeSessions = await this.sessionRepo.find({
      select: ['macAddress'],
      where: { isActive: true },
    });
    const linkedMacs = new Set(activeSessions.map((s) => s.macAddress?.toLowerCase()));

    // 3. Return all hosts for selection
    return allHosts
      .map((h) => ({
        mac: h.mac,
        ip: h.ip,
        deviceName: h.hostName || this.getVendorFromMac(h.mac),
      }));
  }

  private getVendorFromMac(mac: string): string {
    if (!mac) return 'Generic Device';
    // Elite Vendor Mapping (OUI Prefixes)
    const m = mac.toUpperCase();
    
    // Apple
    if (m.startsWith('00:23:24') || m.startsWith('00:25:00') || m.startsWith('00:03:93') || 
        m.startsWith('00:1E:52') || m.startsWith('F0:D1:A9')) return 'Apple Device';
    
    // Samsung
    if (m.startsWith('A4:77:33') || m.startsWith('B0:C0:90') || m.startsWith('00:00:F0') || 
        m.startsWith('00:15:99')) return 'Samsung Galaxy';
        
    // Huawei
    if (m.startsWith('00:18:82') || m.startsWith('00:25:68') || m.startsWith('00:46:4B')) return 'Huawei Device';
    
    // Xiaomi
    if (m.startsWith('00:9E:C8') || m.startsWith('18:F0:E4') || m.startsWith('0C:1D:AF')) return 'Xiaomi Device';
    
    // Transsion (Tecno/Infinix/Itel) - Extremely common in Kenya
    if (m.startsWith('00:08:22') || m.startsWith('14:2D:27') || m.startsWith('38:D2:CA')) return 'Tecno/Infinix';
    
    // PC/Workstations
    if (m.startsWith('BC:6A:40') || m.startsWith('00:0C:29') || m.startsWith('00:50:56')) return 'Laptop/PC';
    
    // Raspberry Pi / IoT
    if (m.startsWith('DC:A6:32') || m.startsWith('B8:27:EB')) return 'Smart Device';
    
    return 'Hotspot Device';
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

    if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.PAID) {
      const msg = sub.status === SubscriptionStatus.AWAITING_APPROVAL 
        ? 'Awaiting Administrator Approval' 
        : sub.status === SubscriptionStatus.VERIFYING 
        ? 'Payment Verification in Progress' 
        : `Subscription is ${sub.status}. Please ensure payment is confirmed.`;
      throw new BadRequestException(msg);
    }

    // LAZY PROVISIONING: Create on MikroTik ONLY if it's the first time (status was PAID)
    if (sub.status === SubscriptionStatus.PAID) {
      this.logger.log(`[LAZY-PROV] Provisioning router ${sub.router.name} for sub ${sub.id}...`);
      try {
        if (sub.router.connectionMode === 'pppoe') {
          await this.mikrotikService.createPppoeSecret(
            sub.router,
            sub.mikrotikUsername,
            sub.mikrotikPassword,
            sub.package.bandwidthProfile,
          );
        } else {
          await this.mikrotikService.createHotspotUser(
            sub.router,
            sub.mikrotikUsername,
            sub.mikrotikPassword,
            sub.package.bandwidthProfile,
          );
        }
      } catch (error: any) {
        this.logger.error(`[LAZY-PROV] Provisioning failed: ${error.message}`);
        throw new BadRequestException(`Router connection failed: ${error.message}`);
      }
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

    // MULTI-DEVICE LOGIC: GHOST-BUSTER - Purge any existing active sessions globally for this MAC
    if (mac) {
      this.logger.log(`[GHOST-BUSTER] Investigating MAC ${mac} for ghost sessions...`);
      
      const existingGlobalSessions = await this.sessionRepo.find({
        where: { 
          macAddress: mac,
          isActive: true,
          subscription: { user: { id: sub.user.id } }
        },
        relations: ['subscription']
      });

      if (existingGlobalSessions.length > 0) {
        this.logger.log(`[GHOST-BUSTER] Purging ${existingGlobalSessions.length} stale sessions for MAC ${mac}`);
        for (const s of existingGlobalSessions) {
          s.isActive = false;
          await this.sessionRepo.save(s);
        }
      }

      // Re-fetch current sub active sessions to ensure accurate limit check
      const currentSubActiveSessions = await this.sessionRepo.find({
        where: { 
          subscription: { id: sub.id },
          isActive: true 
        }
      });

      const existingSessionInSub = currentSubActiveSessions.find((s) => s.macAddress === mac);

      if (!existingSessionInSub) {
        // Check Limit
        const activeDeviceCount = currentSubActiveSessions.length;
        const maxAllowed = sub.package.maxDevices || 1;

        if (activeDeviceCount >= maxAllowed) {
          // Robust fallback: Query all active sessions for this user on this specific router
          // to ensure the user can always see what to disconnect.
          const allUserSessions = await this.sessionRepo.find({
            where: { 
              subscription: { user: { id: sub.user.id } },
              isActive: true 
            },
            relations: ['subscription', 'subscription.package'],
          });

          const connectedDevices = allUserSessions.map((s) => ({
            id: s.id,
            mac: s.macAddress,
            ip: s.ipAddress,
            model: `${s.subscription?.package?.name || 'Device'} (${s.deviceModel || 'Matched'})`,
            connectedAt: s.createdAt,
          }));

          throw new ConflictException({
            message: `You've reached your limit of ${maxAllowed} device(s). Disconnect one below to continue.`,
            error: 'DEVICE_LIMIT_REACHED',
            connectedDevices,
            maxDevices: maxAllowed,
            subId: sub.id,
          });
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
        const loginRes = await this.mikrotikService.loginUser(
          sub.router,
          sub.mikrotikUsername,
          sub.mikrotikPassword,
          finalIp,
          finalMac,
          sub.package.bandwidthProfile,
        );
        
        if (!loginRes?.success) {
           throw new BadRequestException('Router failed to authorize your device. Please try again in 10 seconds.');
        }
      } catch (e) {
        this.logger.error(`Router Login Failed: ${e.message}`);
        throw new BadRequestException(`Connection Error: ${e.message}`);
      }
    }

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
