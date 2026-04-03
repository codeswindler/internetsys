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

  async purchase(
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
      relations: ['package', 'router', 'user'],
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
    
    // Simplify to the absolute basics that we know works in findMy
    const all = await this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router'],
      order: { createdAt: 'DESC' },
    });

    this.logger.log(
      `[DIAGNOSTIC] findAllActive Result: Found ${all.length} raw subs in DB.`,
    );

    // Filter for "Actionable" subs: Inclusion is based on STATUS, not TIME.
    const filtered = all.filter((sub) => {
      const status = sub.status?.toString().toLowerCase();
      // Expanded status list to be extremely forgiving
      const isActionable = ['active', 'pending', 'paid', 'verified', 'processing'].includes(status);
      this.logger.log(`[DIAGNOSTIC] Sub ${sub.id} (${status}) -> Actionable: ${isActionable}`);
      return isActionable;
    });

    this.logger.log(
      `[DIAGNOSTIC] Final Actionable Count: ${filtered.length}`,
    );

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
          `Failed to remove user on expire for sub ${subId}`,
          e,
        );
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

    // Re-create on MikroTik with same credentials
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
    } catch (e) {
      throw new BadRequestException(
        `MikroTik Error on reactivation: ${e.message}`,
      );
    }

    // Calculate new expiry
    const now = new Date();
    const expiresAt = new Date(now);
    const durationCount = sub.package.durationValue;
    switch (sub.package.durationType) {
      case DurationType.MINUTES:
        expiresAt.setMinutes(expiresAt.getMinutes() + durationCount);
        break;
      case DurationType.HOURS:
        expiresAt.setHours(expiresAt.getHours() + durationCount);
        break;
      case DurationType.DAYS:
        expiresAt.setDate(expiresAt.getDate() + durationCount);
        break;
      case DurationType.WEEKS:
        expiresAt.setDate(expiresAt.getDate() + durationCount * 7);
        break;
      case DurationType.MONTHS:
        expiresAt.setMonth(expiresAt.getMonth() + durationCount);
        break;
    }

    sub.status = SubscriptionStatus.ACTIVE;
    sub.startedAt = now;
    sub.expiresAt = expiresAt;

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

    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException(
        `Subscription is in ${sub.status} state, cannot start`,
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
          // Deactivate oldest session if we want to allow "rolling" logins,
          // or block if we want "hard" limits. User said "limit", but usually "rolling" is better UX.
          // Let's go WITH HARD LIMIT FOR NOW per user request "limit number of devices".
          throw new BadRequestException(
            `DEVICE LIMIT REACHED: This package only supports ${maxAllowed} device(s). Please disconnect another device first.`,
          );
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
    const finalMac = mac || sub.user.lastMac;
    const finalIp = ip || sub.user.lastIp;

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
