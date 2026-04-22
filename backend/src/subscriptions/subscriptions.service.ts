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
import { SmsService } from '../sms/sms.service';
import { AccessPointsService } from '../access-points/access-points.service';
import { Admin } from '../entities/admin.entity';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly stkStillProcessingCodes = new Set(['4999']);
  private readonly stkUserCancelledCodes = new Set(['1032']);
  private readonly staleStkVerificationMs = 5 * 60 * 1000;
  private readonly startSessionLocks = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    @InjectRepository(Package) private pkgRepo: Repository<Package>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Router) private routerRepo: Repository<Router>,
    @InjectRepository(Admin) private adminRepo: Repository<Admin>,
    @InjectRepository(DeviceSession)
    private sessionRepo: Repository<DeviceSession>,
    private mikrotikService: MikrotikService,
    private mpesaService: MpesaService,
    private transactionsService: TransactionsService,
    private smsService: SmsService,
    private accessPointsService: AccessPointsService,
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

    const inferredHost = await this.mikrotikService.inferLikelyHotspotHost(router);
    if (inferredHost) {
      this.logger.warn(
        `[SYNC] Falling back to inferred hotspot host ${inferredHost.mac} (${inferredHost.ip}) for user ${userId}`,
      );
      return inferredHost;
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
    notifyAdmins = true,
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

    const saved = await this.subRepo.save(sub);

    if (notifyAdmins) {
      await this.notifyAdminsOfPackageRequest(saved);
    }

    return saved;
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
    if (
      sub.status === SubscriptionStatus.PAID ||
      sub.status === SubscriptionStatus.ACTIVE
    ) {
      return {
        success: true,
        status: sub.status,
        alreadyProcessed: true,
      };
    }
    if (sub.status === SubscriptionStatus.CANCELLED) {
      return {
        success: false,
        failed: true,
        cancelled: true,
        status: SubscriptionStatus.CANCELLED,
        failureReason: 'Payment was not completed. Please try again.',
      };
    }

    try {
      const result = await this.mpesaService.queryStkStatus(sub.mpesaCheckoutId);
      const resultCode = this.normalizeStkResultCode(result?.ResultCode);
      this.logger.log(`[STK QUERY] Sub ${subId} Result: ${resultCode || 'unknown'} - ${result.ResultDesc}`);

      // ResultCode "0" means Success
      if (resultCode === '0') {
        await this.activate(sub.id, PaymentMethod.MPESA, `STK-${sub.mpesaCheckoutId.substring(0, 10)}`);
        return { success: true, status: SubscriptionStatus.PAID, result };
      } 

      if (this.isStkStillProcessing(result)) {
        return { success: false, status: sub.status, processing: true, result };
      }

      return this.markStkPaymentFailed(sub, result);
    } catch (e: any) {
      this.logger.error(`STK Status Query failed for ${subId}: ${e.message}`);
      throw e;
    }
  }

  async activateMpesaCheckout(
    checkoutRequestId: string,
    paymentRef?: string,
  ): Promise<Subscription | null> {
    const sub = await this.subRepo.findOne({
      where: { mpesaCheckoutId: checkoutRequestId },
      relations: ['user', 'package', 'router'],
    });

    if (!sub) {
      this.logger.warn(
        `[STK CALLBACK] Success for unknown checkout ${checkoutRequestId}`,
      );
      return null;
    }

    if (
      sub.status === SubscriptionStatus.PAID ||
      sub.status === SubscriptionStatus.ACTIVE
    ) {
      return sub;
    }

    if (sub.status === SubscriptionStatus.CANCELLED) {
      this.logger.warn(
        `[STK CALLBACK] Success arrived after sub ${sub.id} was marked cancelled. Reopening it for activation.`,
      );
      sub.status = SubscriptionStatus.VERIFYING;
      await this.subRepo.save(sub);
    }

    return this.activate(
      sub.id,
      PaymentMethod.MPESA,
      paymentRef || `STK-${checkoutRequestId.substring(0, 10)}`,
    );
  }

  async failMpesaCheckout(
    checkoutRequestId: string,
    result: any,
  ): Promise<Subscription | null> {
    const sub = await this.subRepo.findOne({
      where: { mpesaCheckoutId: checkoutRequestId },
      relations: ['user', 'package', 'router'],
    });

    if (!sub) {
      this.logger.warn(
        `[STK CALLBACK] Failure for unknown checkout ${checkoutRequestId}: ${result?.ResultCode} - ${result?.ResultDesc}`,
      );
      return null;
    }

    await this.markStkPaymentFailed(sub, result);
    return sub;
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
    sub.expiryNotified = false;
    sub.finalExpiryNotified = false;

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

    if (paymentMethod === PaymentMethod.MPESA) {
      await this.sendPaymentConfirmedNotice(savedSub);
    }

    return savedSub;
  }

  async findMy(userId: string): Promise<Subscription[]> {
    await this.expireOverdueSubscriptionsForUser(userId);
    return this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'user', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });
  }

  async findActive(userId: string): Promise<Subscription | null> {
    await this.expireOverdueSubscriptionsForUser(userId);
    const all = await this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'user', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });
    return all.find(sub => sub.status?.toString().toLowerCase() === 'active') || null;
  }

  async findRecent(userId: string): Promise<any | null> {
    await this.expireOverdueSubscriptionsForUser(userId);
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
    await this.expireOverdueSubscriptionsForUser(userId);
    
    const all = await this.subRepo.find({
      where: { user: { id: userId } },
      relations: ['package', 'router', 'deviceSessions'],
      order: { createdAt: 'DESC' },
    });

    const statusCounts = new Map<string, number>();

    const filtered = all.filter((sub) => {
      const status = sub.status?.toString().toLowerCase().trim();
      const statusKey = status || 'unknown';
      statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
      
      // Even more robust check: If it's physically active or explicitly allocated/pending
      const isActionable = ['active', 'paid', 'pending', 'verified', 'processing', 'allocated', 'awaiting_approval', 'verifying'].includes(status);
      
      return isActionable;
    });

    const statusSummary = [...statusCounts.entries()]
      .map(([status, count]) => `${status}:${count}`)
      .join(',');

    this.logger.debug(
      `[SUBS QUERY] user=${userId} total=${all.length} actionable=${filtered.length} statuses=${statusSummary}`,
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
      relations: ['router', 'deviceSessions', 'user', 'package'],
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

    await this.forceDisconnectSubscriptionDevices(sub, 'expiry');

    sub.status = SubscriptionStatus.EXPIRED;
    await this.subRepo.save(sub);
    await this.sendExpiryNotice(sub);
  }

  async expireIfDue(userId: string, subId: string): Promise<{ expired: boolean; status: SubscriptionStatus | string }> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.user?.id !== userId) {
      throw new BadRequestException('You can only expire your own subscription');
    }

    if (sub.status === SubscriptionStatus.ACTIVE && sub.expiresAt && sub.expiresAt <= new Date()) {
      await this.expireSubscription(sub.id);
      return { expired: true, status: SubscriptionStatus.EXPIRED };
    }

    return { expired: false, status: sub.status };
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

    let captiveResetRequested = false;

    // Remove from MikroTik. For hotspot cancellations, force the device logout
    // first so the active session identity is still available for captive reset.
    if (sub.mikrotikUsername) {
      try {
        if (sub.router.connectionMode === 'pppoe') {
          await this.mikrotikService.removePppoeSecret(
            sub.router,
            sub.mikrotikUsername,
          );
        } else {
          await this.forceDisconnectSubscriptionDevices(sub, 'cancel');
          captiveResetRequested = true;
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

    if (!captiveResetRequested) {
      await this.forceDisconnectSubscriptionDevices(sub, 'cancel');
    }

    sub.status = SubscriptionStatus.CANCELLED;
    const saved = await this.subRepo.save(sub);

    await this.sendCancellationNotice(saved);

    return saved;
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
    sub.expiryNotified = false;
    sub.finalExpiryNotified = false;

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

    // 3. Return only hosts that are not already linked to an active session
    return allHosts
      .filter((h) => h.mac && !linkedMacs.has(h.mac.toLowerCase()))
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

  private async forceDisconnectSubscriptionDevices(
    sub: Subscription,
    reason: 'cancel' | 'expiry',
  ): Promise<void> {
    const seenIdentities = new Set<string>();
    const apKickMacs = new Set<string>();
    const scopeLabel = reason.toUpperCase();

    const rememberApKickMac = (mac?: string | null) => {
      if (mac) apKickMacs.add(mac);
    };

    if (sub.deviceSessions && sub.deviceSessions.length > 0) {
      for (const session of sub.deviceSessions) {
        const sessionIp = session.ipAddress || undefined;
        const sessionMac = session.macAddress || undefined;
        const identityKey = `${sessionMac || ''}|${sessionIp || ''}`;
        rememberApKickMac(sessionMac);

        if ((sessionIp || sessionMac) && !seenIdentities.has(identityKey)) {
          try {
            await this.mikrotikService.forceLogoutHotspot(
              sub.router,
              sessionIp,
              sessionMac,
              sub.mikrotikUsername,
            );
            seenIdentities.add(identityKey);
          } catch (e) {
            this.logger.warn(
              `[${scopeLabel}] Hardware logout failed for session ${session.id}: ${e.message}`,
            );
          }
        }

        session.isActive = false;
      }

      await this.sessionRepo.save(sub.deviceSessions);
    }

    const fallbackIp = sub.user?.lastIp || undefined;
    const fallbackMac = sub.user?.lastMac || undefined;
    const fallbackKey = `${fallbackMac || ''}|${fallbackIp || ''}`;
    rememberApKickMac(fallbackMac);

    if ((fallbackIp || fallbackMac) && !seenIdentities.has(fallbackKey)) {
      try {
        await this.mikrotikService.forceLogoutHotspot(
          sub.router,
          fallbackIp,
          fallbackMac,
          sub.mikrotikUsername,
        );
        this.logger.log(
          `[${scopeLabel}] Applied last-known device logout fallback for sub ${sub.id}.`,
        );
      } catch (e) {
        this.logger.warn(
          `[${scopeLabel}] Last-known device logout fallback failed for sub ${sub.id}: ${e.message}`,
        );
      }
    }

    if (seenIdentities.size === 0 && sub.mikrotikUsername) {
      try {
        await this.mikrotikService.forceLogoutHotspot(
          sub.router,
          undefined,
          undefined,
          sub.mikrotikUsername,
        );
        this.logger.log(
          `[${scopeLabel}] Applied username-only captive reset fallback for sub ${sub.id}.`,
        );
      } catch (e) {
        this.logger.warn(
          `[${scopeLabel}] Username-only captive reset fallback failed for sub ${sub.id}: ${e.message}`,
        );
      }
    }

    for (const mac of apKickMacs) {
      this.accessPointsService
        .disconnectMac(mac, `${reason}:${sub.id}`)
        .catch((e) =>
          this.logger.warn(
            `[${scopeLabel}] AP kick failed for ${mac} on sub ${sub.id}: ${e.message}`,
          ),
        );
    }
  }

  private async sendCancellationNotice(sub: Subscription): Promise<void> {
    if (!sub.user?.phone || sub.user.phone.length < 9) {
      this.logger.warn(
        `[SMS] Skipping cancellation notice for sub ${sub.id}: missing valid phone`,
      );
      return;
    }

    const message = `PulseLynk: Your subscription has ended. Choose a new plan to continue browsing. If the sign in portal does not appear, reconnect to the Wi-Fi network and try again.`;

    try {
      const sent = await this.smsService.sendSms(sub.user.phone, message);
      if (sent) {
        this.logger.log(`[SMS] Sent cancellation notice to ${sub.user.phone}`);
      }
    } catch (e) {
      this.logger.warn(`[SMS] Failed to send cancellation notice for sub ${sub.id}: ${e.message}`);
    }
  }

  private async sendActivationConfirmationNotice(sub: Subscription): Promise<void> {
    if (!sub.user?.phone || sub.user.phone.length < 9) {
      this.logger.warn(
        `[SMS] Skipping activation confirmation for sub ${sub.id}: missing valid phone`,
      );
      return;
    }

    if (!sub.expiresAt) {
      this.logger.warn(
        `[SMS] Skipping activation confirmation for sub ${sub.id}: subscription has no expiry time yet`,
      );
      return;
    }

    const packageName = sub.package?.name || 'internet';
    const routerName = sub.router?.name || 'PulseLynk hotspot';
    const expiryLabel = this.formatNoticeDate(sub.expiresAt);
    const message = `PulseLynk: Your ${packageName} plan is now active on ${routerName}. It expires ${expiryLabel}. Enjoy browsing.`;

    try {
      const sent = await this.smsService.sendSms(sub.user.phone, message);
      if (sent) {
        this.logger.log(`[SMS] Sent activation confirmation to ${sub.user.phone}`);
      }
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send activation confirmation for sub ${sub.id}: ${e.message}`,
      );
    }
  }

  private async sendPaymentConfirmedNotice(sub: Subscription): Promise<void> {
    if (!sub.user?.phone || sub.user.phone.length < 9) {
      this.logger.warn(
        `[SMS] Skipping payment confirmation for sub ${sub.id}: missing valid phone`,
      );
      return;
    }

    const packageName = sub.package?.name || 'internet';
    const message = `PulseLynk: Payment received for your ${packageName} package. Tap Join Network to activate your internet. Your time starts after connection.`;

    try {
      const sent = await this.smsService.sendSms(sub.user.phone, message);
      if (sent) {
        this.logger.log(`[SMS] Sent payment confirmation to ${sub.user.phone}`);
      }
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send payment confirmation for sub ${sub.id}: ${e.message}`,
      );
    }
  }

  private async sendPaymentFailureNotice(
    sub: Subscription,
    failureReason: string,
  ): Promise<void> {
    if (!sub.user?.phone || sub.user.phone.length < 9) {
      this.logger.warn(
        `[SMS] Skipping payment failure notice for sub ${sub.id}: missing valid phone`,
      );
      return;
    }

    const packageName = sub.package?.name || 'internet';
    const message = `PulseLynk: Your ${packageName} payment was not completed. ${failureReason}`;

    try {
      const sent = await this.smsService.sendSms(sub.user.phone, message);
      if (sent) {
        this.logger.log(`[SMS] Sent payment failure notice to ${sub.user.phone}`);
      }
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send payment failure notice for sub ${sub.id}: ${e.message}`,
      );
    }
  }

  private async notifyAdminsOfPackageRequest(sub: Subscription): Promise<void> {
    try {
      const admins = await this.adminRepo.find();
      const recipients = admins.filter(
        (admin) => admin.phone && admin.phone.length >= 9,
      );

      if (!recipients.length) {
        this.logger.warn('[SMS] No admin phone numbers available for package request alert');
        return;
      }

      const customerName =
        sub.user?.name || sub.user?.username || sub.user?.phone || 'a customer';
      const phoneLabel = sub.user?.phone ? ` (${sub.user.phone})` : '';
      const packageName = sub.package?.name || 'internet';
      const amount = Number(sub.amountPaid || sub.package?.price || 0);
      const amountLabel = amount > 0 ? `, KES ${amount.toLocaleString('en-KE')}` : '';
      const routerLabel = sub.router?.name ? ` on ${sub.router.name}` : '';
      const alert = `PulseLynk Admin: New package request from ${customerName}${phoneLabel}: ${packageName}${amountLabel}${routerLabel}. Review in Subscriptions.`;
      const results = await Promise.all(
        recipients.map((admin) => this.smsService.sendSms(admin.phone, alert)),
      );
      const sentCount = results.filter(Boolean).length;
      this.logger.log(
        `[SMS] Sent package request alert to ${sentCount}/${recipients.length} admins`,
      );
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send package request alert to admins: ${e.message}`,
      );
    }
  }

  private async sendExpiryNotice(sub: Subscription): Promise<void> {
    if (sub.finalExpiryNotified) {
      this.logger.debug(
        `[SMS] Skipping expiry notice for sub ${sub.id}: already notified`,
      );
      return;
    }

    if (!sub.user?.phone || sub.user.phone.length < 9) {
      this.logger.warn(
        `[SMS] Skipping expiry notice for sub ${sub.id}: missing valid phone`,
      );
      sub.finalExpiryNotified = true;
      await this.subRepo.save(sub);
      return;
    }

    const message = `PulseLynk: Your subscription has ended. Choose a new plan to continue browsing. If the sign in portal does not appear, reconnect to the Wi-Fi network and try again.`;

    try {
      const sent = await this.smsService.sendSms(sub.user.phone, message);
      if (sent) {
        sub.finalExpiryNotified = true;
        await this.subRepo.save(sub);
        this.logger.log(`[SMS] Sent expiry notice to ${sub.user.phone}`);
      }
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send expiry notice for sub ${sub.id}: ${e.message}`,
      );
    }
  }

  private formatNoticeDate(date: Date): string {
    return new Intl.DateTimeFormat('en-KE', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(date));
  }

  private normalizeStkResultCode(code: any): string {
    return `${code ?? ''}`.trim();
  }

  private isStkStillProcessing(result: any): boolean {
    const code = this.normalizeStkResultCode(result?.ResultCode);
    const detail = `${result?.ResultDesc || ''}`.toLowerCase();

    return (
      this.stkStillProcessingCodes.has(code) ||
      detail.includes('still under processing')
    );
  }

  private getStkFailureReason(result: any): string {
    const code = this.normalizeStkResultCode(result?.ResultCode);
    const detail = `${result?.ResultDesc || ''}`.trim();

    if (code === '2001') {
      return 'The M-Pesa PIN was incorrect. Please try the purchase again.';
    }

    if (code === '1032') {
      return 'Payment was cancelled on your phone.';
    }

    if (code === '1037') {
      return 'No response was received from your phone. Please try again.';
    }

    return detail || 'Payment was not completed. Please try again.';
  }

  private async markStkPaymentFailed(
    sub: Subscription,
    result: any,
    options: { notifyUser?: boolean } = {},
  ): Promise<any> {
    const resultCode = this.normalizeStkResultCode(result?.ResultCode) || 'UNKNOWN';
    const failureReason = this.getStkFailureReason(result);
    const cancelled = this.stkUserCancelledCodes.has(resultCode);
    const notifyUser = options.notifyUser ?? true;
    let markedFailedNow = false;

    if (
      sub.status !== SubscriptionStatus.CANCELLED &&
      sub.status !== SubscriptionStatus.PAID &&
      sub.status !== SubscriptionStatus.ACTIVE
    ) {
      sub.status = SubscriptionStatus.CANCELLED;
      sub.paymentMethod = PaymentMethod.MPESA;
      sub.paymentRef = `STK-FAILED-${resultCode}`.substring(0, 255);
      await this.subRepo.save(sub);
      markedFailedNow = true;
      this.logger.warn(
        `[STK FAILED] Sub ${sub.id} marked CANCELLED | code=${resultCode} | detail=${failureReason}`,
      );
    }

    if (markedFailedNow && notifyUser) {
      await this.sendPaymentFailureNotice(sub, failureReason);
    }

    return {
      success: false,
      failed: true,
      cancelled,
      status: SubscriptionStatus.CANCELLED,
      failureReason,
      result,
    };
  }

  async startSession(
    userId: string,
    id: string,
    mac?: string,
    ip?: string,
    userAgent?: string,
  ): Promise<any> {
    const existingStart = this.startSessionLocks.get(id);
    if (existingStart) {
      this.logger.warn(`[START-LOCK] Reusing in-flight start request for sub ${id}.`);
      return existingStart;
    }

    const startPromise = this.startSessionUnlocked(userId, id, mac, ip, userAgent)
      .finally(() => this.startSessionLocks.delete(id));

    this.startSessionLocks.set(id, startPromise);
    return startPromise;
  }

  private async startSessionUnlocked(
    userId: string,
    id: string,
    mac?: string,
    ip?: string,
    userAgent?: string,
  ): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['user', 'package', 'router', 'deviceSessions'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.user?.id !== userId) {
      throw new BadRequestException('You can only start your own subscription');
    }

    this.logger.log(
      `[START-STEP] Loaded sub ${sub.id} | status=${sub.status} | router=${sub.router?.name || 'n/a'} | mode=${sub.router?.connectionMode || 'n/a'} | mac=${mac || 'none'} | ip=${ip || 'none'}`,
    );

    // Capture and Save Device Model if missing
    const model = userAgent ? this.parseUserAgent(userAgent) : 'Unknown Device';

    if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.PAID) {
      const msg = sub.status === SubscriptionStatus.AWAITING_APPROVAL 
        ? 'Awaiting Administrator Approval' 
        : sub.status === SubscriptionStatus.VERIFYING 
        ? 'Payment Verification in Progress' 
        : `Subscription is ${sub.status}. Please ensure payment is confirmed.`;
      this.logger.warn(`[START-REJECT] Sub ${sub.id} rejected before router auth | status=${sub.status} | reason=${msg}`);
      throw new BadRequestException(msg);
    }

    // PPPoE still needs a secret before start. Hotspot users are upserted by
    // loginUser after device validation, so retries cannot touch the router early.
    if (sub.status === SubscriptionStatus.PAID && sub.router.connectionMode === 'pppoe') {
      this.logger.log(`[LAZY-PROV] Provisioning PPPoE secret on ${sub.router.name} for sub ${sub.id}...`);
      try {
        await this.mikrotikService.createPppoeSecret(
          sub.router,
          sub.mikrotikUsername,
          sub.mikrotikPassword,
          sub.package.bandwidthProfile,
        );
      } catch (error: any) {
        this.logger.error(`[LAZY-PROV] Provisioning failed: ${error.message}`);
        throw new BadRequestException(`Router connection failed: ${error.message}`);
      }
    }

    // Resolve the current device from the router itself so device-limit state
    // and "this device" UI stay aligned with the actual connected hardware.
    let finalIp = ip || undefined;
    let finalMac = mac || undefined;

    const shouldInferHostFromRouter =
      sub.router.connectionMode !== 'pppoe' &&
      (!finalMac || !finalIp || this.isPublicIpv4(finalIp));

    if (shouldInferHostFromRouter) {
      const inferredHost = await this.mikrotikService.inferLikelyHotspotHost(sub.router);
      if (inferredHost) {
        if (!finalMac) {
          finalMac = inferredHost.mac;
        }
        if (!finalIp || this.isPublicIpv4(finalIp)) {
          finalIp = inferredHost.ip || finalIp;
        }
        this.logger.warn(
          `[HOST-INFER] Using hotspot host ${inferredHost.mac} (${inferredHost.ip}) for sub ${sub.id}. Incoming MAC=${mac || 'none'}, IP=${ip || 'none'}`,
        );
      }
    }

    if (!finalMac && finalIp && !this.isPublicIpv4(finalIp)) {
      finalMac = (await this.mikrotikService.findMacByIp(sub.router, finalIp)) || undefined;
    }

    if (!finalMac && !finalIp) {
      this.logger.warn(`[START-REJECT] Sub ${sub.id} missing resolved MAC/IP after identity lookup.`);
      throw new BadRequestException(
        'Missing MAC and IP address bindings to assign this package to.',
      );
    }

    if (!finalMac) {
      this.logger.warn(`[START-REJECT] Sub ${sub.id} missing MAC after identity lookup | ip=${finalIp || 'none'}`);
      throw new BadRequestException(
        'Unable to identify your device on the hotspot. Please retry Link Device.',
      );
    }

    this.logger.log(
      `[START-STEP] Verifying hotspot host presence for sub ${sub.id} | mac=${finalMac} | ip=${finalIp || 'none'}`,
    );
    const isPresent = await this.mikrotikService.verifyHostPresence(sub.router, finalMac, finalIp);
    if (!isPresent) {
      this.logger.warn(
        `[START-REJECT] Hotspot host not present for sub ${sub.id} | mac=${finalMac} | ip=${finalIp || 'none'}`,
      );
      throw new BadRequestException(
        'CONNECTION REJECTED: You are not physically connected to the hotspot Wi-Fi network. Please connect to the Wi-Fi first to activate this package.',
      );
    }
    this.logger.log(`[START-STEP] Hotspot host verified for sub ${sub.id}.`);

    await this.persistLatestDeviceIdentity(sub.user, finalMac, finalIp);

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
      this.logger.warn(
        `[START-REJECT] Sub ${sub.id} blocked by live sub ${liveSub.id} (${liveSub.package?.name || 'unknown package'}).`,
      );
      throw new BadRequestException(
        `CONFLICT: You already have a live session (${liveSub.package?.name}). You must wait for it to expire before starting a new one.`,
      );
    }

    // MULTI-DEVICE LOGIC: GHOST-BUSTER - Purge any existing active sessions globally for this MAC
    if (finalMac) {
      this.logger.log(`[GHOST-BUSTER] Investigating MAC ${finalMac} for ghost sessions...`);
      
      const existingGlobalSessions = await this.sessionRepo.find({
        where: { 
          macAddress: finalMac,
          isActive: true,
          subscription: { user: { id: sub.user.id } }
        },
        relations: ['subscription']
      });

      if (existingGlobalSessions.length > 0) {
        this.logger.log(`[GHOST-BUSTER] Purging ${existingGlobalSessions.length} stale sessions for MAC ${finalMac}`);
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

      const existingSessionInSub = currentSubActiveSessions.find((s) => s.macAddress === finalMac);

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
          macAddress: finalMac,
          ipAddress: finalIp,
          deviceModel: model,
          isActive: true,
        });
        await this.sessionRepo.save(newSession);
      } else {
        // Update existing session
        existingSessionInSub.ipAddress = finalIp || existingSessionInSub.ipAddress;
        existingSessionInSub.deviceModel = model;
        existingSessionInSub.isActive = true;
        await this.sessionRepo.save(existingSessionInSub);
      }
    }

    // 2. ALWAYS attempt login on MikroTik
    let authorizationMode: 'active-login' | 'bypass' = 'bypass';

    if (finalMac || finalIp) {
      try {
        this.logger.log(
          `[START-STEP] Authorizing router session for sub ${sub.id} | mac=${finalMac} | ip=${finalIp || 'none'}`,
        );
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
        authorizationMode =
          loginRes?.authorizationMode === 'active-login'
            ? 'active-login'
            : 'bypass';

        const isConfirmed = await this.verifyHotspotConnectionWithRetry(
          sub.router,
          finalMac,
          finalIp,
          sub.mikrotikUsername,
          { allowBypassBinding: authorizationMode === 'bypass' },
        );

        if (!isConfirmed) {
          this.logger.warn(
            `[CONNECT-PENDING] Router authorization for sub ${sub.id} could not be verified after retry window.`,
          );
          throw new BadRequestException(
            'Connection is still initializing. Please retry Link Device in a few seconds.',
          );
        }
      } catch (e) {
        this.logger.error(`Router Login Failed: ${e.message}`);
        throw new BadRequestException(`Connection Error: ${e.message}`);
      }
    }

    const activatedNow = !sub.startedAt;
    if (activatedNow) {
      this.activateSubscriptionClock(sub);
    }

    const savedSub = await this.subRepo.save(sub);

    if (activatedNow) {
      await this.sendActivationConfirmationNotice(savedSub);
    }

    this.logger.log(
      `[CONNECT-SUCCESS] Sub ${savedSub.id} authorized via ${authorizationMode} | MAC: ${finalMac} | IP: ${finalIp} | Expires: ${savedSub.expiresAt?.toISOString() || 'pending'}`,
    );

    return {
      ...savedSub,
      handshakeRequired: false,
      activationPending: false,
      connectionConfirmed: true,
      authorizationMode,
      resolvedMac: finalMac,
      resolvedIp: finalIp,
    };
  }

  async confirmConnection(
    userId: string,
    id: string,
    mac?: string,
    ip?: string,
  ): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['user', 'package', 'router', 'deviceSessions'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.user?.id !== userId) {
      throw new BadRequestException('You can only confirm your own subscription');
    }

    if (sub.status !== SubscriptionStatus.PAID && sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException(`Subscription is ${sub.status}.`);
    }

    const finalIp = ip || sub.user.lastIp;
    let finalMac: string | undefined = mac || sub.user.lastMac || undefined;

    if (!finalMac && finalIp) {
      finalMac = (await this.mikrotikService.findMacByIp(sub.router, finalIp)) || undefined;
    }

    if (!finalMac && !finalIp) {
      throw new BadRequestException('Missing MAC and IP address bindings to confirm connection.');
    }

    await this.persistLatestDeviceIdentity(sub.user, finalMac, finalIp);

    const isConfirmed = await this.verifyHotspotConnectionWithRetry(
      sub.router,
      finalMac,
      finalIp,
      sub.mikrotikUsername,
      { allowBypassBinding: true },
    );

    if (!isConfirmed) {
      throw new ConflictException({
        message: 'Connection handshake is still pending. Time has not started. Please retry Join Network.',
        error: 'CONNECTION_NOT_CONFIRMED',
        subId: sub.id,
      });
    }

    const activatedNow = !sub.startedAt;
    if (activatedNow) {
      this.activateSubscriptionClock(sub);
    }

    const savedSub = await this.subRepo.save(sub);

    if (activatedNow) {
      await this.sendActivationConfirmationNotice(savedSub);
    }

    this.logger.log(
      `[CONNECT-CONFIRMED] Sub ${savedSub.id} active | MAC: ${finalMac} | IP: ${finalIp} | Expires: ${savedSub.expiresAt?.toISOString() || 'pending'}`,
    );

    return {
      ...savedSub,
      handshakeRequired: false,
      activationPending: false,
      connectionConfirmed: true,
      resolvedMac: finalMac,
      resolvedIp: finalIp,
    };
  }

  private async verifyHotspotConnectionWithRetry(
    router: Router,
    mac?: string,
    ip?: string,
    username?: string,
    options: { allowBypassBinding?: boolean } = {},
  ) {
    const maxAttempts = options.allowBypassBinding ? 5 : 6;
    const waitMs = options.allowBypassBinding ? 400 : 500;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const isConfirmed = await this.mikrotikService.verifyHotspotConnection(
        router,
        mac,
        ip,
        username,
        options,
      );

      if (isConfirmed) {
        return true;
      }

      if (attempt < maxAttempts - 1) {
        await this.wait(waitMs);
      }
    }

    return false;
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isPublicIpv4(ip?: string): boolean {
    if (!ip) {
      return false;
    }

    const octets = ip
      .trim()
      .split('.')
      .map((part) => Number(part));

    if (
      octets.length !== 4 ||
      octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)
    ) {
      return false;
    }

    if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) {
      return false;
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return false;
    }
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return false;
    }
    if (octets[0] === 169 && octets[1] === 254) {
      return false;
    }
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
      return false;
    }

    return true;
  }

  private activateSubscriptionClock(sub: Subscription) {
    sub.startedAt = new Date();
    sub.status = SubscriptionStatus.ACTIVE;
    sub.expiryNotified = false;
    sub.finalExpiryNotified = false;

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

  private async persistLatestDeviceIdentity(user: User, mac?: string, ip?: string) {
    let changed = false;
    if (mac && user.lastMac !== mac) {
      user.lastMac = mac;
      changed = true;
    }
    if (ip && user.lastIp !== ip) {
      user.lastIp = ip;
      changed = true;
    }

    if (changed) {
      await this.userRepo.save(user);
    }
  }

  async getTrafficStats(userId: string): Promise<any> {
    await this.expireOverdueSubscriptionsForUser(userId);
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

  private async expireOverdueSubscriptionsForUser(userId: string): Promise<void> {
    const overdueSubs = await this.subRepo.find({
      where: {
        user: { id: userId },
        status: SubscriptionStatus.ACTIVE,
      },
      relations: ['router', 'deviceSessions'],
    });

    for (const sub of overdueSubs) {
      if (sub.expiresAt && sub.expiresAt <= new Date()) {
        await this.expireSubscription(sub.id);
      }
    }

    const staleVerifyingSubs = await this.subRepo.find({
      where: {
        user: { id: userId },
        status: SubscriptionStatus.VERIFYING,
      },
      relations: ['user', 'package', 'router'],
    });

    const staleBefore = Date.now() - this.staleStkVerificationMs;
    for (const sub of staleVerifyingSubs) {
      if (!sub.updatedAt || sub.updatedAt.getTime() > staleBefore) {
        continue;
      }

      await this.markStkPaymentFailed(sub, {
        ResultCode: 'TIMEOUT',
        ResultDesc: 'Payment verification timed out before completion.',
      }, {
        notifyUser: false,
      });
    }
  }
}
