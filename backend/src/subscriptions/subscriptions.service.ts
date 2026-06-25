import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
  PaymentMethod,
} from '../entities/subscription.entity';
import { Package, DurationType } from '../entities/package.entity';
import { User } from '../entities/user.entity';
import { Router } from '../entities/router.entity';
import { DeviceSession } from '../entities/device-session.entity';
import {
  HotspotDeviceActivity,
  MikrotikService,
} from '../routers/mikrotik.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionMethod } from '../entities/transaction.entity';
import { MpesaService } from './mpesa.service';
import { SmsService } from '../sms/sms.service';
import {
  AccessPointsService,
  InfrastructureDeviceHints,
} from '../access-points/access-points.service';
import { Admin } from '../entities/admin.entity';

type SubscriptionExpiryResult = 'processed' | 'skipped' | 'not-found';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly stkStillProcessingCodes = new Set(['4999']);
  private readonly stkUserCancelledCodes = new Set(['1032']);
  private readonly staleStkVerificationMs = 5 * 60 * 1000;
  private readonly carryOverPresenceWindowMs = 5 * 60 * 1000;
  private readonly liveTrafficThresholdBytes = 50 * 1024;
  private readonly startSessionLocks = new Map<string, Promise<any>>();
  private readonly stkStatusLocks = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    @InjectRepository(Package) private pkgRepo: Repository<Package>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Router) private routerRepo: Repository<Router>,
    @InjectRepository(Admin) private adminRepo: Repository<Admin>,
    @InjectRepository(DeviceSession)
    private sessionRepo: Repository<DeviceSession>,
    private dataSource: DataSource,
    private mikrotikService: MikrotikService,
    private mpesaService: MpesaService,
    private transactionsService: TransactionsService,
    private smsService: SmsService,
    private accessPointsService: AccessPointsService,
  ) {}

  private async getInfrastructureDeviceHints(
    router?: Router | null,
  ): Promise<InfrastructureDeviceHints> {
    try {
      return await this.accessPointsService.getInfrastructureDeviceHints(router?.name);
    } catch (e: any) {
      this.logger.warn(
        `[INFRA-FILTER] Could not load AP infrastructure hints: ${e.message}`,
      );
      return {
        macs: new Set(),
        macPrefixes: [],
        hostKeywords: ['pulselynk', 'unifi', 'ubnt', 'uap'],
      };
    }
  }

  private isInfrastructureDevice(
    mac?: string | null,
    hostName?: string | null,
    hints?: InfrastructureDeviceHints,
  ): boolean {
    if (!hints) return false;
    const normalizedMac = this.normalizeMac(mac);
    if (normalizedMac && hints.macs.has(normalizedMac)) return true;
    if (
      normalizedMac &&
      hints.macPrefixes.some((prefix) => normalizedMac.startsWith(prefix))
    ) {
      return true;
    }

    const normalizedHostName = `${hostName || ''}`.trim().toLowerCase();
    if (!normalizedHostName) return false;

    return hints.hostKeywords.some((keyword) =>
      normalizedHostName.includes(keyword.toLowerCase()),
    );
  }

  private filterCustomerHotspotHosts<T extends { mac?: string; hostName?: string }>(
    hosts: T[],
    hints: InfrastructureDeviceHints,
  ): T[] {
    return hosts.filter((host) => {
      const isInfrastructure = this.isInfrastructureDevice(
        host.mac,
        host.hostName,
        hints,
      );
      if (isInfrastructure) {
        this.logger.warn(
          `[INFRA-FILTER] Ignoring infrastructure hotspot host ${host.mac || 'unknown'} (${host.hostName || 'unnamed'}).`,
        );
      }
      return !isInfrastructure;
    });
  }

  private filterCustomerAuthorizations<
    T extends { mac?: string; deviceName?: string },
  >(authorizations: T[], hints: InfrastructureDeviceHints): T[] {
    return authorizations.filter((authorization) => {
      const isInfrastructure = this.isInfrastructureDevice(
        authorization.mac,
        authorization.deviceName,
        hints,
      );
      if (isInfrastructure) {
        this.logger.warn(
          `[INFRA-FILTER] Ignoring infrastructure hotspot authorization ${authorization.mac || 'unknown'} (${authorization.deviceName || 'unnamed'}).`,
        );
      }
      return !isInfrastructure;
    });
  }

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
    const infrastructureHints = await this.getInfrastructureDeviceHints(router);
    const allHosts = this.filterCustomerHotspotHosts(
      await this.mikrotikService.getAllHosts(router),
      infrastructureHints,
    );
    
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

    const inferredHost = await this.mikrotikService.inferLikelyHotspotHost(
      router,
      {
        excludeMacs: infrastructureHints.macs,
        excludeMacPrefixes: infrastructureHints.macPrefixes,
        excludeHostKeywords: infrastructureHints.hostKeywords,
      },
    );
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

  async listGuestPackages() {
    const packages = await this.pkgRepo.find({
      where: { isActive: true },
      order: { price: 'ASC' },
    });

    return packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      durationType: pkg.durationType,
      durationValue: pkg.durationValue,
      price: pkg.price,
      dataLimitMB: pkg.dataLimitMB,
      downloadSpeed: pkg.downloadSpeed,
      uploadSpeed: pkg.uploadSpeed,
      maxDevices: pkg.maxDevices,
    }));
  }

  async listGuestRouters() {
    const routers = await this.routerRepo.find({
      where: { isOnline: true },
      order: { name: 'ASC' },
    });

    return routers.map((router) => ({
      id: router.id,
      name: router.name,
      localGateway: router.localGateway,
      connectionMode: router.connectionMode,
      isOnline: router.isOnline,
    }));
  }

  async createGuestMpesaCheckout(
    userId: string,
    packageId: string,
    routerId: string | undefined,
    phone: string,
  ) {
    const formattedPhone = this.smsService.formatPhone(phone);
    if (!formattedPhone || formattedPhone.length < 9) {
      throw new BadRequestException('Please enter a valid M-Pesa phone number');
    }

    const sub = await this.purchase(userId, packageId, routerId, false);
    await this.setStatus(sub.id, SubscriptionStatus.VERIFYING);

    try {
      const amount = Number(sub.package?.price || sub.amountPaid || 0);
      if (!amount || Number.isNaN(amount)) {
        throw new BadRequestException('Package price is invalid');
      }

      const mpesaRes = await this.mpesaService.stkPush(
        formattedPhone,
        amount,
        `SUB-${sub.id.substring(0, 8)}`,
        'Internet Subscription',
      );

      if (mpesaRes.CheckoutRequestID) {
        await this.updateMpesaCheckoutId(sub.id, mpesaRes.CheckoutRequestID);
      }

      return {
        success: true,
        sub: await this.getGuestSubscriptionPayload(sub.id),
        daraja: mpesaRes,
      };
    } catch (e) {
      await this.setStatus(sub.id, SubscriptionStatus.CANCELLED);
      throw e;
    }
  }

  async getGuestSubscriptionForPhone(
    subId: string,
    phone: string,
  ): Promise<Subscription> {
    const formattedPhone = this.smsService.formatPhone(phone);
    const rawPhone = phone?.trim();
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    if (
      sub.user?.phone !== formattedPhone &&
      (!rawPhone || sub.user?.phone !== rawPhone)
    ) {
      throw new NotFoundException('Subscription not found');
    }

    return sub;
  }

  async getGuestSubscriptionPayload(subId: string) {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['package', 'router'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    return {
      id: sub.id,
      status: sub.status,
      amountPaid: sub.amountPaid,
      package: sub.package
        ? {
            id: sub.package.id,
            name: sub.package.name,
            durationType: sub.package.durationType,
            durationValue: sub.package.durationValue,
            price: sub.package.price,
            dataLimitMB: sub.package.dataLimitMB,
            downloadSpeed: sub.package.downloadSpeed,
            uploadSpeed: sub.package.uploadSpeed,
            maxDevices: sub.package.maxDevices,
          }
        : null,
      router: sub.router
        ? {
            id: sub.router.id,
            name: sub.router.name,
            localGateway: sub.router.localGateway,
            connectionMode: sub.router.connectionMode,
          }
        : null,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
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
    const existingStatusCheck = this.stkStatusLocks.get(subId);
    if (existingStatusCheck) {
      this.logger.warn(`[STK LOCK] Reusing in-flight STK status check for sub ${subId}.`);
      return existingStatusCheck;
    }

    const statusPromise = this.checkStkStatusUnlocked(subId).finally(() =>
      this.stkStatusLocks.delete(subId),
    );

    this.stkStatusLocks.set(subId, statusPromise);
    return statusPromise;
  }

  private async checkStkStatusUnlocked(subId: string): Promise<any> {
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
        await this.refreshStkVerification(sub.id);
        return { success: false, status: sub.status, processing: true, result };
      }

      return this.markStkPaymentFailed(sub, result);
    } catch (e: any) {
      const detail = `${e?.message || ''}`.toLowerCase();
      if (
        sub.status === SubscriptionStatus.VERIFYING &&
        detail.includes('temporarily unavailable')
      ) {
        await this.refreshStkVerification(sub.id);
        return {
          success: false,
          status: sub.status,
          processing: true,
          transientError: true,
          failureReason: 'Safaricom status checks are temporarily unavailable. Verification is still in progress.',
        };
      }
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

  async expireSubscription(subId: string): Promise<SubscriptionExpiryResult> {
    return this.withSubscriptionExpiryLock(subId, () =>
      this.expireSubscriptionUnlocked(subId),
    );
  }

  private async expireSubscriptionUnlocked(subId: string): Promise<SubscriptionExpiryResult> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['router', 'deviceSessions', 'user', 'package'],
    });
    if (!sub) return 'not-found';
    if (
      sub.status !== SubscriptionStatus.ACTIVE ||
      !sub.expiresAt ||
      sub.expiresAt > new Date()
    ) {
      this.logger.debug(
        `[EXPIRY] Skipping sub ${sub.id}; status=${sub.status} expires=${sub.expiresAt?.toISOString() || 'none'}`,
      );
      return 'skipped';
    }

    const carryOverResult = await this.tryCarryOverExpiredSubscription(sub);
    if (carryOverResult.status === 'carried') {
      return 'processed';
    }

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

    if (carryOverResult.status === 'waiting' && carryOverResult.nextSub) {
      await this.sendQueuedPackageReadyNotice(
        sub,
        carryOverResult.nextSub,
        carryOverResult.reason,
      );
    } else {
      await this.sendExpiryNotice(sub);
    }

    return 'processed';
  }

  private async withSubscriptionExpiryLock(
    subId: string,
    work: () => Promise<SubscriptionExpiryResult>,
  ): Promise<SubscriptionExpiryResult> {
    const lockKey = `pulselynk_expire_sub_${subId}`;
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      const lockResult = await queryRunner.query(
        'SELECT GET_LOCK(?, 0) AS lockStatus',
        [lockKey],
      );
      const hasLock = Number(lockResult?.[0]?.lockStatus || 0) === 1;

      if (!hasLock) {
        this.logger.warn(
          `[EXPIRY] Skipping sub ${subId}; another request is already processing it.`,
        );
        return 'skipped';
      }

      try {
        return await work();
      } finally {
        try {
          await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockKey]);
        } catch (e: any) {
          this.logger.warn(
            `[EXPIRY] Failed to release subscription lock for ${subId}: ${e.message}`,
          );
        }
      }
    } finally {
      await queryRunner.release();
    }
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
      const result = await this.expireSubscription(sub.id);
      if (result === 'processed') {
        return { expired: true, status: SubscriptionStatus.EXPIRED };
      }

      const currentSub = await this.subRepo.findOne({ where: { id: subId } });
      return {
        expired: currentSub?.status === SubscriptionStatus.EXPIRED,
        status: currentSub?.status || result,
      };
    }

    return { expired: false, status: sub.status };
  }

  private async tryCarryOverExpiredSubscription(
    sub: Subscription,
  ): Promise<{
    status: 'none' | 'waiting' | 'carried';
    nextSub?: Subscription;
    reason?: 'offline' | 'device-limit' | 'authorization-failed';
  }> {
    if (
      !sub.user?.id ||
      !sub.router ||
      sub.router.connectionMode === 'pppoe'
    ) {
      return { status: 'none' };
    }

    const nextSubs = await this.findPaidCarryOverCandidates(sub);
    const firstNextSub = nextSubs[0];
    if (!firstNextSub) {
      return { status: 'none' };
    }

    const activeSessionRows = (sub.deviceSessions || []).filter(
      (session) => session.isActive && (session.macAddress || session.ipAddress),
    );
    const currentSessions = await this.buildCarryOverSessionCandidates(
      sub,
      activeSessionRows,
    );

    if (currentSessions.length === 0) {
      this.logger.log(
        `[CARRY-OVER] Sub ${sub.id} has queued package ${firstNextSub.id}, but no linked device identity was available.`,
      );
      return { status: 'waiting', nextSub: firstNextSub, reason: 'offline' };
    }

    if (activeSessionRows.length === 0) {
      this.logger.log(
        `[CARRY-OVER] Sub ${sub.id} has no active DB session rows; probing router and last-known identities for carry-over.`,
      );
    }

    let activityPairs: Array<{
      session: DeviceSession;
      activity: HotspotDeviceActivity;
    }>;

    try {
      activityPairs = await this.refreshHotspotSessionActivity(
        sub.router,
        currentSessions,
      );
    } catch (e: any) {
      this.logger.warn(
        `[CARRY-OVER] Could not check router presence for sub ${sub.id}: ${e.message}`,
      );
      return { status: 'none' };
    }

    const now = Date.now();
    const recentlySeenPairs = this.dedupeCarryOverPairs(
      activityPairs.filter(({ session, activity }) => {
        if (activity.isSeen) return true;
        if (!session.lastSeenAt) return false;
        return now - new Date(session.lastSeenAt).getTime() <= this.carryOverPresenceWindowMs;
      }),
    );

    if (recentlySeenPairs.length === 0) {
      this.logger.log(
        `[CARRY-OVER] Queued package ${firstNextSub.id} will wait: no devices from sub ${sub.id} were seen on the router within 5 minutes.`,
      );
      return { status: 'waiting', nextSub: firstNextSub, reason: 'offline' };
    }

    const eligiblePairs: Array<{
      session: DeviceSession;
      activity: HotspotDeviceActivity;
    }> = [];

    for (const pair of recentlySeenPairs) {
      const conflictSub = await this.findLiveSubscriptionForDevice(
        sub.user.id,
        sub.id,
        pair.activity.mac || pair.session.macAddress,
        pair.activity.ip || pair.session.ipAddress,
      );

      if (conflictSub) {
        this.logger.warn(
          `[CARRY-OVER] Skipping ${pair.activity.mac || pair.session.macAddress || pair.activity.ip || pair.session.ipAddress || 'unknown device'} because it is already active on sub ${conflictSub.id}.`,
        );
        continue;
      }

      eligiblePairs.push(pair);
    }

    if (eligiblePairs.length === 0) {
      this.logger.warn(
        `[CARRY-OVER] Queued package ${firstNextSub.id} will wait: all seen devices are already assigned to other live packages.`,
      );
      return { status: 'waiting', nextSub: firstNextSub, reason: 'device-limit' };
    }

    const remainingPairs = [...eligiblePairs];
    const activatedSubs: Subscription[] = [];
    let oldRouterUserRemoved = false;

    for (const nextSub of nextSubs) {
      if (remainingPairs.length === 0) break;

      const wasAlreadyActive = nextSub.status === SubscriptionStatus.ACTIVE;
      const maxDevices = nextSub.package?.maxDevices || 1;
      const existingActiveCount = (nextSub.deviceSessions || []).filter(
        (session) => session.isActive,
      ).length;
      const availableSlots = Math.max(maxDevices - existingActiveCount, 0);

      if (availableSlots <= 0) {
        this.logger.warn(
          `[CARRY-OVER] Queued package ${nextSub.id} has no free device slots; max=${maxDevices} active=${existingActiveCount}.`,
        );
        continue;
      }

      const pairsForSub = remainingPairs.splice(0, availableSlots);
      if (pairsForSub.length === 0) continue;

      if (this.ensureSubscriptionCredentials(nextSub)) {
        await this.subRepo.save(nextSub);
      }

      if (!oldRouterUserRemoved && sub.mikrotikUsername) {
        await this.mikrotikService.removeHotspotUser(
          sub.router,
          sub.mikrotikUsername,
        );
        oldRouterUserRemoved = true;
      }

      const carriedPairs = await this.authorizeCarryOverDevices(
        nextSub,
        pairsForSub,
      );

      if (carriedPairs.length === 0) {
        remainingPairs.unshift(...pairsForSub);
        this.logger.warn(
          `[CARRY-OVER] Queued package ${nextSub.id} will wait: no router authorizations succeeded.`,
        );
        continue;
      }

      const carriedKeys = new Set(
        carriedPairs.map((pair) => {
          const mac = this.normalizeMac(pair.activity.mac || pair.session.macAddress);
          const ip = pair.activity.ip || pair.session.ipAddress;
          return mac ? `mac:${mac}` : ip ? `ip:${ip}` : `session:${pair.session.id}`;
        }),
      );
      const failedPairs = pairsForSub.filter((pair) => {
        const mac = this.normalizeMac(pair.activity.mac || pair.session.macAddress);
        const ip = pair.activity.ip || pair.session.ipAddress;
        const key = mac ? `mac:${mac}` : ip ? `ip:${ip}` : `session:${pair.session.id}`;
        return !carriedKeys.has(key);
      });

      if (failedPairs.length > 0) {
        remainingPairs.unshift(...failedPairs);
      }

      if (!wasAlreadyActive) {
        this.activateSubscriptionClock(nextSub);
      }
      const savedNextSub = await this.subRepo.save(nextSub);
      await this.moveCarriedDeviceSessions(sub, savedNextSub, carriedPairs);
      if (!wasAlreadyActive) {
        await this.sendActivationConfirmationNotice(savedNextSub);
      }
      activatedSubs.push(savedNextSub);

      this.logger.log(
        `[CARRY-OVER] ${wasAlreadyActive ? 'Added device(s) to active' : 'Activated queued'} sub ${savedNextSub.id} from expired sub ${sub.id}; devices=${carriedPairs.length}; expires=${savedNextSub.expiresAt?.toISOString() || 'pending'}`,
      );
    }

    if (activatedSubs.length === 0) {
      this.logger.warn(
        `[CARRY-OVER] Queued package ${firstNextSub.id} will wait: no router authorizations succeeded.`,
      );
      return { status: 'waiting', nextSub: firstNextSub, reason: 'authorization-failed' };
    }

    sub.status = SubscriptionStatus.EXPIRED;
    sub.finalExpiryNotified = true;
    await this.subRepo.save(sub);

    if (remainingPairs.length > 0) {
      this.logger.warn(
        `[CARRY-OVER] ${remainingPairs.length} device(s) from expired sub ${sub.id} were left uncarried because queued package capacity was exhausted.`,
      );
    }

    return { status: 'carried', nextSub: activatedSubs[0] };
  }

  private async findPaidCarryOverCandidates(
    expiringSub: Subscription,
  ): Promise<Subscription[]> {
    if (!expiringSub.user?.id || !expiringSub.router?.id) return [];

    const now = new Date();
    return this.subRepo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.user', 'user')
      .leftJoinAndSelect('sub.package', 'package')
      .leftJoinAndSelect('sub.router', 'router')
      .leftJoinAndSelect('sub.deviceSessions', 'deviceSessions')
      .where('user.id = :userId', { userId: expiringSub.user.id })
      .andWhere('router.id = :routerId', { routerId: expiringSub.router.id })
      .andWhere(
        '(sub.status = :paidStatus OR (sub.status = :activeStatus AND sub.expiresAt > :now))',
        {
          paidStatus: SubscriptionStatus.PAID,
          activeStatus: SubscriptionStatus.ACTIVE,
          now,
        },
      )
      .andWhere('sub.id != :subId', { subId: expiringSub.id })
      .orderBy(
        `CASE WHEN sub.status = '${SubscriptionStatus.ACTIVE}' THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('sub.createdAt', 'ASC')
      .getMany();
  }

  private ensureSubscriptionCredentials(sub: Subscription): boolean {
    let changed = false;
    const phone = sub.user?.phone || '000000';

    if (!sub.mikrotikUsername) {
      sub.mikrotikUsername = `net_${phone.substring(phone.length - 6)}_${Date.now().toString().substring(7)}`;
      changed = true;
    }

    if (!sub.mikrotikPassword) {
      sub.mikrotikPassword = Math.random().toString(36).slice(-6);
      changed = true;
    }

    return changed;
  }

  private dedupeCarryOverPairs(
    pairs: Array<{ session: DeviceSession; activity: HotspotDeviceActivity }>,
  ): Array<{ session: DeviceSession; activity: HotspotDeviceActivity }> {
    const seen = new Set<string>();

    return pairs.filter((pair) => {
      const mac = this.normalizeMac(pair.activity.mac || pair.session.macAddress);
      const ip = pair.activity.ip || pair.session.ipAddress;
      const key = mac ? `mac:${mac}` : ip ? `ip:${ip}` : `session:${pair.session.id}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private async buildCarryOverSessionCandidates(
    sub: Subscription,
    activeSessions: DeviceSession[],
  ): Promise<DeviceSession[]> {
    const infrastructureHints = await this.getInfrastructureDeviceHints(sub.router);
    const candidates = activeSessions.filter(
      (session) =>
        !this.isInfrastructureDevice(
          session.macAddress,
          session.deviceModel,
          infrastructureHints,
        ),
    );
    const findCandidate = (mac?: string | null, ip?: string | null) => {
      const normalizedMac = this.normalizeMac(mac);
      return candidates.find((candidate) => {
        const candidateMac = this.normalizeMac(candidate.macAddress);
        const macMatches =
          !!normalizedMac &&
          !!candidateMac &&
          normalizedMac === candidateMac;
        const ipMatches =
          !!ip &&
          !!candidate.ipAddress &&
          ip === candidate.ipAddress;

        return macMatches || ipMatches;
      });
    };
    const addCandidate = (
      mac?: string | null,
      ip?: string | null,
      deviceModel?: string | null,
    ) => {
      const normalizedMac = this.normalizeMac(mac);
      const normalizedIp = ip || undefined;
      if (!normalizedMac && !normalizedIp) return;
      if (this.isInfrastructureDevice(normalizedMac, deviceModel, infrastructureHints)) {
        this.logger.warn(
          `[CARRY-OVER] Skipping infrastructure device ${normalizedMac || normalizedIp || 'unknown'} for sub ${sub.id}.`,
        );
        return;
      }

      const existing = findCandidate(normalizedMac, normalizedIp);
      if (existing) {
        if (normalizedMac && !existing.macAddress) existing.macAddress = normalizedMac;
        if (normalizedIp && !existing.ipAddress) existing.ipAddress = normalizedIp;
        if (deviceModel && !existing.deviceModel) existing.deviceModel = deviceModel;
        return;
      }

      candidates.push(
        this.sessionRepo.create({
          subscription: sub,
          macAddress: normalizedMac || '',
          ipAddress: normalizedIp,
          deviceModel:
            deviceModel || sub.user?.deviceModel || 'Connected Device',
          isActive: true,
          lastSeenAt: null,
        }),
      );
    };

    if (sub.router && sub.mikrotikUsername) {
      try {
        const routerAuthorizations =
          this.filterCustomerAuthorizations(
            await this.mikrotikService.listHotspotAuthorizations(
              sub.router,
              sub.mikrotikUsername,
            ),
            infrastructureHints,
          );

        for (const authorization of routerAuthorizations) {
          addCandidate(
            authorization.mac,
            authorization.ip,
            authorization.deviceName,
          );
        }
      } catch (e: any) {
        this.logger.warn(
          `[CARRY-OVER] Could not read router authorizations for sub ${sub.id}: ${e.message}`,
        );
      }
    }

    addCandidate(sub.user?.lastMac, sub.user?.lastIp, sub.user?.deviceModel);

    return candidates;
  }

  private async refreshHotspotSessionActivity(
    router: Router,
    sessions: DeviceSession[],
  ): Promise<Array<{ session: DeviceSession; activity: HotspotDeviceActivity }>> {
    const activities = await this.mikrotikService.listHotspotDeviceActivity(
      router,
      sessions.map((session) => ({
        mac: session.macAddress,
        ip: session.ipAddress,
      })),
    );
    const now = new Date();
    const pairs = sessions.map((session, index) => {
      const activity =
        activities[index] ||
        ({
          mac: session.macAddress,
          ip: session.ipAddress,
          isSeen: false,
          bytesIn: 0,
          bytesOut: 0,
        } as HotspotDeviceActivity);
      const previousBytesIn = Number.parseInt(`${session.lastBytesIn || '0'}`, 10) || 0;
      const previousBytesOut = Number.parseInt(`${session.lastBytesOut || '0'}`, 10) || 0;
      const byteDelta = Math.max(activity.bytesIn - previousBytesIn, 0) +
        Math.max(activity.bytesOut - previousBytesOut, 0);

      if (activity.isSeen) {
        session.lastSeenAt = now;
        if (activity.mac) session.macAddress = activity.mac;
        if (activity.ip) session.ipAddress = activity.ip;
        if (activity.deviceName && !session.deviceModel) {
          session.deviceModel = activity.deviceName;
        }
        if (byteDelta >= this.liveTrafficThresholdBytes) {
          session.lastTrafficAt = now;
        }
        session.lastBytesIn = `${activity.bytesIn}`;
        session.lastBytesOut = `${activity.bytesOut}`;
      }

      return { session, activity };
    });

    const sessionsToSave = pairs
      .filter(({ session, activity }) => session.id || activity.isSeen)
      .map(({ session }) => session);

    if (sessionsToSave.length > 0) {
      await this.sessionRepo.save(sessionsToSave);
    }
    return pairs;
  }

  private async authorizeCarryOverDevices(
    nextSub: Subscription,
    pairs: Array<{ session: DeviceSession; activity: HotspotDeviceActivity }>,
  ): Promise<Array<{ session: DeviceSession; activity: HotspotDeviceActivity }>> {
    const carriedPairs: Array<{
      session: DeviceSession;
      activity: HotspotDeviceActivity;
    }> = [];

    for (const pair of pairs) {
      const mac = pair.activity.mac || pair.session.macAddress;
      const ip = pair.activity.ip || pair.session.ipAddress;

      try {
        const loginRes = await this.mikrotikService.loginUser(
          nextSub.router,
          nextSub.mikrotikUsername,
          nextSub.mikrotikPassword,
          ip,
          mac,
          nextSub.package.bandwidthProfile,
          nextSub.package.maxDevices || 1,
        );
        const authorizationMode =
          loginRes?.authorizationMode === 'active-login'
            ? 'active-login'
            : 'bypass';
        const confirmed = await this.verifyHotspotConnectionWithRetry(
          nextSub.router,
          mac,
          ip,
          nextSub.mikrotikUsername,
          { allowBypassBinding: authorizationMode === 'bypass' },
        );

        if (!confirmed) {
          this.logger.warn(
            `[CARRY-OVER] Router auth was not confirmed for ${mac || ip || 'unknown'} on queued sub ${nextSub.id}.`,
          );
          continue;
        }

        carriedPairs.push(pair);
      } catch (e: any) {
        this.logger.warn(
          `[CARRY-OVER] Failed to authorize ${mac || ip || 'unknown'} on queued sub ${nextSub.id}: ${e.message}`,
        );
      }
    }

    return carriedPairs;
  }

  private async moveCarriedDeviceSessions(
    oldSub: Subscription,
    nextSub: Subscription,
    pairs: Array<{ session: DeviceSession; activity: HotspotDeviceActivity }>,
  ): Promise<void> {
    const now = new Date();
    const oldSessions = (oldSub.deviceSessions || []).filter(
      (session) => session.isActive,
    );

    for (const session of oldSessions) {
      session.isActive = false;
    }

    if (oldSessions.length > 0) {
      await this.sessionRepo.save(oldSessions);
    }

    for (const pair of pairs) {
      const normalizedMac = this.normalizeMac(
        pair.activity.mac || pair.session.macAddress,
      );
      const existing = (nextSub.deviceSessions || []).find(
        (session) => this.normalizeMac(session.macAddress) === normalizedMac,
      );
      const session =
        existing ||
        this.sessionRepo.create({
          subscription: nextSub,
          macAddress: pair.activity.mac || pair.session.macAddress,
        });

      session.subscription = nextSub;
      session.macAddress = pair.activity.mac || pair.session.macAddress;
      session.ipAddress = pair.activity.ip || pair.session.ipAddress;
      session.deviceModel =
        pair.activity.deviceName ||
        pair.session.deviceModel ||
        oldSub.user?.deviceModel ||
        'Connected Device';
      session.isActive = true;
      session.lastSeenAt = now;
      session.lastTrafficAt = pair.session.lastTrafficAt || null;
      session.lastBytesIn = `${pair.activity.bytesIn || pair.session.lastBytesIn || 0}`;
      session.lastBytesOut = `${pair.activity.bytesOut || pair.session.lastBytesOut || 0}`;
      await this.sessionRepo.save(session);
    }

    const preferred = pairs[0];
    if (preferred) {
      await this.persistLatestDeviceIdentity(
        oldSub.user,
        preferred.activity.mac || preferred.session.macAddress,
        preferred.activity.ip || preferred.session.ipAddress,
        preferred.activity.deviceName || preferred.session.deviceModel,
      );
    }
  }

  async cancelSubscription(subId: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['user', 'package', 'router', 'deviceSessions'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (
      sub.status !== SubscriptionStatus.ACTIVE &&
      sub.status !== SubscriptionStatus.PAID
    ) {
      throw new BadRequestException(
        `Cannot cancel a subscription in ${sub.status} state`,
      );
    }

    let captiveResetRequested = false;
    const isRunningSubscription = sub.status === SubscriptionStatus.ACTIVE;

    // Remove from MikroTik. For hotspot cancellations, force the device logout
    // first so the active session identity is still available for captive reset.
    if (isRunningSubscription && sub.mikrotikUsername) {
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

    if (isRunningSubscription && !captiveResetRequested) {
      await this.forceDisconnectSubscriptionDevices(sub, 'cancel');
    } else if (!isRunningSubscription) {
      const activeSessions = (sub.deviceSessions || []).filter(
        (deviceSession) => deviceSession.isActive,
      );
      for (const deviceSession of activeSessions) {
        deviceSession.isActive = false;
      }
      if (activeSessions.length > 0) {
        await this.sessionRepo.save(activeSessions);
      }
    }

    sub.status = SubscriptionStatus.CANCELLED;
    if (!isRunningSubscription) {
      sub.startedAt = null;
      sub.expiresAt = null;
    }
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
    if (sessionId.startsWith('router:')) {
      const match = sessionId.match(/^router:([0-9a-f-]{36}):(.+)$/i);
      if (!match) {
        throw new BadRequestException('Invalid router-backed device session');
      }

      const subId = match[1];
      let identity = match[2];
      try {
        identity = decodeURIComponent(identity);
      } catch {
        // Older router-backed IDs may already be plain text.
      }

      const sub = await this.subRepo.findOne({
        where: { id: subId },
        relations: ['user', 'router', 'deviceSessions'],
      });

      if (!sub) throw new NotFoundException('Subscription not found');
      if (sub.user?.id !== userId) {
        throw new BadRequestException('You can only disconnect your own devices');
      }

      const normalizedIdentityMac = this.normalizeMac(identity);
      const isMac = normalizedIdentityMac.length === 12;
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(identity);
      const targetMac = isMac ? identity : undefined;
      const targetIp = isIp ? identity : undefined;

      if (!targetMac && !targetIp) {
        throw new BadRequestException('Could not identify the router-backed device to disconnect');
      }

      const matchingSessions = (sub.deviceSessions || []).filter((deviceSession) => {
        const macMatches =
          !!targetMac &&
          this.normalizeMac(deviceSession.macAddress) === normalizedIdentityMac;
        const ipMatches =
          !!targetIp &&
          !!deviceSession.ipAddress &&
          deviceSession.ipAddress === targetIp;

        return deviceSession.isActive && (macMatches || ipMatches);
      });

      if (matchingSessions.length > 0) {
        for (const deviceSession of matchingSessions) {
          deviceSession.isActive = false;
        }
        await this.sessionRepo.save(matchingSessions);
      }

      if (sub.router) {
        try {
          await this.mikrotikService.forceLogoutHotspot(
            sub.router,
            targetIp,
            targetMac,
          );
          this.logger.log(
            `[DISCONNECT] Removed router-backed device ${targetMac || targetIp} from router ${sub.router.name}`,
          );
        } catch (e: any) {
          this.logger.warn(
            `[DISCONNECT] Router-backed cleanup failed for ${targetMac || targetIp}: ${e.message}`,
          );
          throw new BadRequestException('Failed to disconnect the router-backed device. Please try again.');
        }
      }

      const deviceLabel =
        matchingSessions[0]?.deviceModel ||
        targetMac ||
        targetIp ||
        'Router device';

      return {
        success: true,
        message: `Device ${deviceLabel} disconnected`,
      };
    }

    if (sessionId.startsWith('last-known:')) {
      const subId = sessionId.replace('last-known:', '');
      const sub = await this.subRepo.findOne({
        where: { id: subId },
        relations: ['user', 'router', 'deviceSessions'],
      });

      if (!sub) throw new NotFoundException('Subscription not found');
      if (sub.user?.id !== userId) {
        throw new BadRequestException('You can only disconnect your own devices');
      }

      const activeSessions = (sub.deviceSessions || []).filter((deviceSession) => deviceSession.isActive);
      if (activeSessions.length > 0) {
        for (const deviceSession of activeSessions) {
          deviceSession.isActive = false;
        }
        await this.sessionRepo.save(activeSessions);
      }

      if (sub.router && (sub.user?.lastMac || sub.user?.lastIp)) {
        try {
          await this.mikrotikService.forceLogoutHotspot(
            sub.router,
            sub.user?.lastIp || undefined,
            sub.user?.lastMac || undefined,
          );
          this.logger.log(
            `[DISCONNECT] Applied fallback hotspot logout for sub ${sub.id} using last-known identity ${sub.user?.lastMac || 'unknown-mac'}.`,
          );
        } catch (e: any) {
          this.logger.warn(
            `[DISCONNECT] Fallback router cleanup failed for sub ${sub.id}: ${e.message}`,
          );
          throw new BadRequestException('Failed to disconnect the last authorized device. Please try again.');
        }
      }

      return {
        success: true,
        message: `Last authorized device disconnected`,
      };
    }

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
    const infrastructureHints = await this.getInfrastructureDeviceHints(sub.router);
    const allHosts = this.filterCustomerHotspotHosts(
      await this.mikrotikService.getAllHosts(sub.router),
      infrastructureHints,
    );
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

        if ((sessionIp || sessionMac) && !seenIdentities.has(identityKey)) {
          const activeOwner = await this.findLiveSubscriptionForDevice(
            sub.user?.id || '',
            sub.id,
            sessionMac,
            sessionIp,
          );

          if (activeOwner) {
            this.logger.warn(
              `[${scopeLabel}] Skipping hardware logout for ${sessionMac || sessionIp || 'unknown device'} because it is active on sub ${activeOwner.id}.`,
            );
            session.isActive = false;
            continue;
          }

          rememberApKickMac(sessionMac);

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

    if ((fallbackIp || fallbackMac) && !seenIdentities.has(fallbackKey)) {
      const activeOwner = await this.findLiveSubscriptionForDevice(
        sub.user?.id || '',
        sub.id,
        fallbackMac,
        fallbackIp,
      );

      if (activeOwner) {
        this.logger.warn(
          `[${scopeLabel}] Skipping last-known logout fallback for ${fallbackMac || fallbackIp || 'unknown device'} because it is active on sub ${activeOwner.id}.`,
        );
      } else {
        rememberApKickMac(fallbackMac);

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

  private async sendQueuedPackageReadyNotice(
    expiredSub: Subscription,
    nextSub: Subscription,
    reason?: 'offline' | 'device-limit' | 'authorization-failed',
  ): Promise<void> {
    if (expiredSub.finalExpiryNotified) {
      return;
    }

    if (!expiredSub.user?.phone || expiredSub.user.phone.length < 9) {
      expiredSub.finalExpiryNotified = true;
      await this.subRepo.save(expiredSub);
      return;
    }

    const packageName = nextSub.package?.name || 'next package';
    const maxDevices = nextSub.package?.maxDevices || 1;
    const message =
      reason === 'device-limit'
        ? `PulseLynk: Your previous plan has ended. Your ${packageName} package is ready, but it supports ${maxDevices} device(s). Reconnect the device you want to use and tap Connect to start it.`
        : `PulseLynk: Your previous plan has ended. Your ${packageName} package is ready and will start when you reconnect to the Wi-Fi and tap Connect.`;

    try {
      const sent = await this.smsService.sendSms(expiredSub.user.phone, message);
      if (sent) {
        expiredSub.finalExpiryNotified = true;
        await this.subRepo.save(expiredSub);
        this.logger.log(
          `[SMS] Sent queued package ready notice to ${expiredSub.user.phone}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send queued package notice for sub ${expiredSub.id}: ${e.message}`,
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

  private async refreshStkVerification(subId: string): Promise<void> {
    await this.subRepo.update(subId, {
      status: SubscriptionStatus.VERIFYING,
      updatedAt: new Date(),
    });
  }

  private async getActiveSessionsForSubscription(subId: string): Promise<DeviceSession[]> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.subscription', 'subscription')
      .where('subscription.id = :subId', { subId })
      .andWhere('session.isActive = :isActive', { isActive: true })
      .orderBy('session.updatedAt', 'DESC')
      .getMany();
  }

  private async getRecentSessionsForSubscription(
    subId: string,
  ): Promise<DeviceSession[]> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.subscription', 'subscription')
      .where('subscription.id = :subId', { subId })
      .orderBy('session.updatedAt', 'DESC')
      .getMany();
  }

  private async getActiveSessionsForUserMac(
    userId: string,
    macAddress: string,
  ): Promise<DeviceSession[]> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.subscription', 'subscription')
      .leftJoin('subscription.user', 'user')
      .where('user.id = :userId', { userId })
      .andWhere('session.isActive = :isActive', { isActive: true })
      .andWhere('session.macAddress = :macAddress', { macAddress })
      .orderBy('session.updatedAt', 'DESC')
      .getMany();
  }

  private pickPreferredActiveSession(
    sessions: DeviceSession[],
  ): DeviceSession | undefined {
    return [...sessions].sort((a, b) => {
      const aTime = (a.updatedAt || a.createdAt)?.getTime?.() || 0;
      const bTime = (b.updatedAt || b.createdAt)?.getTime?.() || 0;
      return bTime - aTime;
    })[0];
  }

  private buildConnectedDevicesPayload(
    sessions: Array<
      Pick<DeviceSession, 'id' | 'macAddress' | 'ipAddress' | 'deviceModel' | 'createdAt'>
    >,
    packageName?: string,
  ) {
    return sessions.map((session) => ({
      id: session.id,
      mac: session.macAddress,
      ip: session.ipAddress,
      model: session.deviceModel || `${packageName || 'Device'} (Matched)`,
      connectedAt: session.createdAt,
    }));
  }

  private async findLiveSubscriptionForDevice(
    userId: string,
    excludeSubId: string,
    mac?: string | null,
    ip?: string | null,
  ): Promise<Subscription | null> {
    const normalizedMac = this.normalizeMac(mac);
    const normalizedIp = ip || undefined;

    if (!normalizedMac && !normalizedIp) return null;

    const liveSubs = await this.subRepo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.package', 'package')
      .leftJoinAndSelect('sub.router', 'router')
      .leftJoinAndSelect('sub.deviceSessions', 'deviceSessions')
      .leftJoin('sub.user', 'user')
      .where('user.id = :userId', { userId })
      .andWhere('sub.id != :excludeSubId', { excludeSubId })
      .andWhere('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.expiresAt > :now', { now: new Date() })
      .getMany();

    for (const liveSub of liveSubs) {
      const dbMatch = (liveSub.deviceSessions || []).some((session) => {
        if (!session.isActive) return false;

        const sessionMac = this.normalizeMac(session.macAddress);
        const macMatches =
          !!normalizedMac &&
          !!sessionMac &&
          normalizedMac === sessionMac;
        const ipMatches =
          !!normalizedIp &&
          !!session.ipAddress &&
          normalizedIp === session.ipAddress;

        return macMatches || ipMatches;
      });

      if (dbMatch) return liveSub;

      if (
        liveSub.router?.connectionMode === 'hotspot' &&
        liveSub.mikrotikUsername
      ) {
        try {
          const authorizations =
            await this.mikrotikService.listHotspotAuthorizations(
              liveSub.router,
              liveSub.mikrotikUsername,
            );
          const routerMatch = authorizations.some((authorization) => {
            const authorizationMac = this.normalizeMac(authorization.mac);
            const macMatches =
              !!normalizedMac &&
              !!authorizationMac &&
              normalizedMac === authorizationMac;
            const ipMatches =
              !!normalizedIp &&
              !!authorization.ip &&
              normalizedIp === authorization.ip;

            return macMatches || ipMatches;
          });

          if (routerMatch) return liveSub;
        } catch (e: any) {
          this.logger.warn(
            `[START-CHECK] Could not verify live device assignment on sub ${liveSub.id}: ${e.message}`,
          );
        }
      }
    }

    return null;
  }

  async startSession(
    userId: string,
    id: string,
    mac?: string,
    ip?: string,
    userAgent?: string,
  ): Promise<any> {
    const lockIdentity =
      this.normalizeMac(mac) ||
      (ip && !this.isPublicIpv4(ip) ? ip : 'no-device-identity');
    const lockKey = `${id}:${lockIdentity}`;
    const existingStart = this.startSessionLocks.get(lockKey);
    if (existingStart) {
      this.logger.warn(
        `[START-LOCK] Reusing in-flight start request for sub ${id} | identity=${lockIdentity}.`,
      );
      return existingStart;
    }

    const startPromise = this.startSessionUnlocked(userId, id, mac, ip, userAgent)
      .finally(() => this.startSessionLocks.delete(lockKey));

    this.startSessionLocks.set(lockKey, startPromise);
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
    const infrastructureHints = await this.getInfrastructureDeviceHints(sub.router);
    const currentSubSessions = (await this.getRecentSessionsForSubscription(sub.id))
      .filter(
        (session) =>
          !this.isInfrastructureDevice(
            session.macAddress,
            session.deviceModel,
            infrastructureHints,
          ),
      );
    const currentSubActiveSessions = currentSubSessions.filter(
      (session) => session.isActive,
    );
    const maxAllowed = sub.package.maxDevices || 1;
    const preferredActiveSession =
      sub.status === SubscriptionStatus.ACTIVE
        ? this.pickPreferredActiveSession(currentSubActiveSessions)
        : undefined;
    const preferredKnownSession =
      sub.status === SubscriptionStatus.ACTIVE && !preferredActiveSession
        ? this.pickPreferredActiveSession(currentSubSessions)
        : preferredActiveSession;
    const limitReferenceSessions = currentSubActiveSessions;
    const buildDeviceLimitConflict = (
      fallbackOverride?: Array<
        Pick<DeviceSession, 'id' | 'macAddress' | 'ipAddress' | 'deviceModel' | 'createdAt'>
      >,
    ) => {
      const fallbackSessions: Array<
        Pick<DeviceSession, 'id' | 'macAddress' | 'ipAddress' | 'deviceModel' | 'createdAt'>
      > = fallbackOverride ? [...fallbackOverride] : [];

      if (!fallbackOverride && preferredKnownSession) {
        fallbackSessions.push(preferredKnownSession);
      } else if (!fallbackOverride && sub.user?.lastMac) {
        fallbackSessions.push({
          id: `last-known:${sub.id}`,
          macAddress: sub.user.lastMac,
          ipAddress: sub.user.lastIp,
          deviceModel: sub.user.deviceModel || 'Last Authorized Device',
          createdAt: sub.updatedAt || sub.createdAt,
        });
      }

      const connectedDevices = this.buildConnectedDevicesPayload(
        limitReferenceSessions.length > 0 ? limitReferenceSessions : fallbackSessions,
        sub.package?.name,
      );

      return new ConflictException({
        message: `You've reached your limit of ${maxAllowed} device(s). Disconnect one below to continue.`,
        error: 'DEVICE_LIMIT_REACHED',
        connectedDevices,
        maxDevices: maxAllowed,
        subId: sub.id,
      });
    };
    let finalIp = ip || undefined;
    let finalMac = mac || undefined;

    if (this.isInfrastructureDevice(finalMac, undefined, infrastructureHints)) {
      this.logger.warn(
        `[INFRA-FILTER] Ignoring incoming infrastructure identity ${finalMac} for sub ${sub.id}.`,
      );
      finalMac = undefined;
      if (finalIp && !this.isPublicIpv4(finalIp)) {
        finalIp = undefined;
      }
    }

    const hasExplicitDeviceIdentity =
      !!finalMac || (!!finalIp && !this.isPublicIpv4(finalIp));
    const shouldRequireExplicitIdentity =
      sub.status === SubscriptionStatus.ACTIVE &&
      maxAllowed === 1 &&
      !hasExplicitDeviceIdentity &&
      currentSubActiveSessions.length >= maxAllowed;

    if (shouldRequireExplicitIdentity) {
      const connectedDevices = this.buildConnectedDevicesPayload(
        currentSubActiveSessions,
        sub.package?.name,
      );

      this.logger.warn(
        `[START-LIMIT] Sub ${sub.id} has an active device and no explicit incoming hotspot identity. Incoming MAC=${mac || 'none'}, IP=${ip || 'none'}`,
      );
      throw new ConflictException({
        message: `You've reached your limit of ${maxAllowed} device(s). Disconnect one below to continue.`,
        error: 'DEVICE_LIMIT_REACHED',
        connectedDevices,
        maxDevices: maxAllowed,
        subId: sub.id,
      });
    }

    const shouldCheckRouterSlotOccupancy =
      sub.status === SubscriptionStatus.ACTIVE &&
      sub.router.connectionMode !== 'pppoe' &&
      maxAllowed === 1 &&
      !hasExplicitDeviceIdentity;

    if (shouldCheckRouterSlotOccupancy) {
      const routerAuthorizations = this.filterCustomerAuthorizations(
        await this.mikrotikService.listHotspotAuthorizations(
          sub.router,
          sub.mikrotikUsername,
        ),
        infrastructureHints,
      );
      const routerHasAuthorizedDevice = routerAuthorizations.length > 0;

      if (routerHasAuthorizedDevice) {
        const fallbackSession = preferredKnownSession
          ? [preferredKnownSession]
          : sub.user?.lastMac
            ? [{
                id: `last-known:${sub.id}`,
                macAddress: sub.user.lastMac,
                ipAddress: sub.user.lastIp,
                deviceModel: sub.user.deviceModel || 'Last Authorized Device',
                createdAt: sub.updatedAt || sub.createdAt,
              }]
            : [];
        const connectedDevices = this.buildConnectedDevicesPayload(
          currentSubActiveSessions.length > 0
            ? currentSubActiveSessions
            : fallbackSession,
          sub.package?.name,
        );

        this.logger.warn(
          `[START-LIMIT] Router already has an authorized hotspot device for sub ${sub.id}; requiring user handoff before host inference.`,
        );
        throw new ConflictException({
          message: `You've reached your limit of ${maxAllowed} device(s). Disconnect one below to continue.`,
          error: 'DEVICE_LIMIT_REACHED',
          connectedDevices,
          maxDevices: maxAllowed,
          subId: sub.id,
        });
      }
    }

    const incomingMac = this.normalizeMac(finalMac);
    const knownMac = this.normalizeMac(preferredKnownSession?.macAddress);
    const explicitMacMatchesKnown =
      !!incomingMac && !!knownMac && incomingMac === knownMac;
    const explicitIpMatchesKnown =
      !!finalIp &&
      !this.isPublicIpv4(finalIp) &&
      !!preferredKnownSession?.ipAddress &&
      finalIp === preferredKnownSession.ipAddress;
    const canReuseKnownSessionIdentity =
      !!preferredKnownSession &&
      (explicitMacMatchesKnown || explicitIpMatchesKnown);

    if (canReuseKnownSessionIdentity && preferredKnownSession) {
      const reusedMac = !finalMac && preferredKnownSession.macAddress;
      const reusedIp =
        (!finalIp || this.isPublicIpv4(finalIp)) &&
        preferredKnownSession.ipAddress;

      if (reusedMac) {
        finalMac = preferredKnownSession.macAddress;
      }
      if (reusedIp) {
        finalIp = preferredKnownSession.ipAddress;
      }

      if (reusedMac || reusedIp) {
        this.logger.log(
          `[START-STEP] Reusing known session identity for sub ${sub.id} | mac=${preferredKnownSession.macAddress || 'none'} | ip=${preferredKnownSession.ipAddress || 'none'}`,
        );
      }
    }

    const shouldInferHostFromRouter =
      sub.router.connectionMode !== 'pppoe' &&
      (!finalMac || !finalIp || this.isPublicIpv4(finalIp));

    if (shouldInferHostFromRouter) {
      const inferredHost = await this.mikrotikService.inferLikelyHotspotHost(
        sub.router,
        {
          excludeMacs: infrastructureHints.macs,
          excludeMacPrefixes: infrastructureHints.macPrefixes,
          excludeHostKeywords: infrastructureHints.hostKeywords,
        },
      );
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
      if (this.isInfrastructureDevice(finalMac, undefined, infrastructureHints)) {
        this.logger.warn(
          `[INFRA-FILTER] Ignoring infrastructure MAC ${finalMac} resolved from IP ${finalIp} for sub ${sub.id}.`,
        );
        finalMac = undefined;
        finalIp = undefined;
      }
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

    const liveSubUsingThisDevice = await this.findLiveSubscriptionForDevice(
      sub.user.id,
      sub.id,
      finalMac,
      finalIp,
    );

    if (liveSubUsingThisDevice) {
      this.logger.warn(
        `[START-REJECT] Device ${finalMac || finalIp || 'unknown'} is already assigned to live sub ${liveSubUsingThisDevice.id} (${liveSubUsingThisDevice.package?.name || 'unknown package'}).`,
      );
      throw new BadRequestException(
        `This device is already using ${liveSubUsingThisDevice.package?.name || 'another live package'}. Disconnect it there first, or use a different device for this package.`,
      );
    }

    const routerLimitFallbackSessions: Array<
      Pick<DeviceSession, 'id' | 'macAddress' | 'ipAddress' | 'deviceModel' | 'createdAt'>
    > = [];
    let existingRouterAuthorizationMode: 'active-login' | 'bypass' | undefined;
    if (
      sub.status === SubscriptionStatus.ACTIVE &&
      sub.router.connectionMode !== 'pppoe' &&
      sub.mikrotikUsername &&
      maxAllowed > 0
    ) {
      const routerAuthorizations =
        this.filterCustomerAuthorizations(
          await this.mikrotikService.listHotspotAuthorizations(
            sub.router,
            sub.mikrotikUsername,
          ),
          infrastructureHints,
        );
      const normalizedFinalMacForLimit = this.normalizeMac(finalMac);
      const matchingRouterAuthorization = routerAuthorizations.find((authorization) => {
        const authorizationMac = this.normalizeMac(authorization.mac);
        const macMatches =
          !!normalizedFinalMacForLimit &&
          !!authorizationMac &&
          authorizationMac === normalizedFinalMacForLimit;
        const ipMatches =
          !!finalIp &&
          !!authorization.ip &&
          authorization.ip === finalIp;

        return macMatches || ipMatches;
      });
      if (matchingRouterAuthorization) {
        existingRouterAuthorizationMode =
          matchingRouterAuthorization.source === 'active'
            ? 'active-login'
            : 'bypass';
      }
      const activeRouterAuthorizationCount = routerAuthorizations.length;

      for (const authorization of routerAuthorizations) {
        const matchingKnownSession = currentSubSessions.find((session) => {
          const sessionMac = this.normalizeMac(session.macAddress);
          const authorizationMac = this.normalizeMac(authorization.mac);
          const macMatches =
            !!sessionMac &&
            !!authorizationMac &&
            sessionMac === authorizationMac;
          const ipMatches =
            !!session.ipAddress &&
            !!authorization.ip &&
            session.ipAddress === authorization.ip;

          return macMatches || ipMatches;
        });
        const authorizationIdentity = encodeURIComponent(
          authorization.mac || authorization.ip || `${routerLimitFallbackSessions.length}`,
        );

        routerLimitFallbackSessions.push({
          id: `router:${sub.id}:${authorizationIdentity}`,
          macAddress: authorization.mac || 'Router authorized device',
          ipAddress: authorization.ip || '',
          deviceModel:
            matchingKnownSession?.deviceModel ||
            authorization.deviceName ||
            (authorization.source === 'bypass'
              ? 'Router Bypass Device'
              : 'Router Active Device'),
          createdAt: new Date(),
        });
      }

      const knownActiveDeviceCount = Math.max(
        limitReferenceSessions.length,
        activeRouterAuthorizationCount,
      );

      if (knownActiveDeviceCount >= maxAllowed && !matchingRouterAuthorization) {
        this.logger.warn(
          `[START-LIMIT] Router already has ${activeRouterAuthorizationCount} authorized device(s) for sub ${sub.id}; blocking new device ${finalMac || finalIp || 'unknown'} before auth.`,
        );
        throw buildDeviceLimitConflict(routerLimitFallbackSessions);
      }
    }

    // MULTI-DEVICE LOGIC: GHOST-BUSTER - Purge any existing active sessions globally for this MAC
    let reusedCurrentActiveSession = false;
    let routerAuthSession: DeviceSession | undefined;
    let routerAuthSessionWasCreated = false;
    let routerAuthPreviousState:
      | Pick<DeviceSession, 'ipAddress' | 'deviceModel' | 'isActive'>
      | undefined;
    const rollbackRouterAuthSession = async () => {
      if (!routerAuthSession) return;

      try {
        if (routerAuthSessionWasCreated) {
          await this.sessionRepo.remove(routerAuthSession);
          return;
        }

        if (routerAuthPreviousState) {
          routerAuthSession.ipAddress = routerAuthPreviousState.ipAddress;
          routerAuthSession.deviceModel = routerAuthPreviousState.deviceModel;
          routerAuthSession.isActive = routerAuthPreviousState.isActive;
          await this.sessionRepo.save(routerAuthSession);
        }
      } catch (rollbackError: any) {
        this.logger.warn(
          `[START-ROLLBACK] Failed to rollback router auth session for sub ${sub.id}: ${rollbackError.message}`,
        );
      }
    };

    if (finalMac) {
      this.logger.log(`[GHOST-BUSTER] Investigating MAC ${finalMac} for ghost sessions...`);
      
      const existingGlobalSessions = await this.getActiveSessionsForUserMac(
        sub.user.id,
        finalMac,
      );
      const staleGlobalSessions = existingGlobalSessions.filter(
        (s) => s.subscription?.id !== sub.id,
      );

      if (staleGlobalSessions.length > 0) {
        this.logger.log(`[GHOST-BUSTER] Purging ${staleGlobalSessions.length} stale sessions for MAC ${finalMac}`);
        for (const s of staleGlobalSessions) {
          s.isActive = false;
          await this.sessionRepo.save(s);
        }
      }

      const normalizedFinalMac = this.normalizeMac(finalMac);
      const existingSessionInSub = currentSubSessions.find(
        (s) => this.normalizeMac(s.macAddress) === normalizedFinalMac,
      );
      const matchingLimitSession = limitReferenceSessions.find(
        (s) => this.normalizeMac(s.macAddress) === normalizedFinalMac,
      );

      if (!existingSessionInSub) {
        // Check Limit
        const activeDeviceCount = limitReferenceSessions.length;

        if (activeDeviceCount >= maxAllowed && !matchingLimitSession) {
          const connectedDevices = this.buildConnectedDevicesPayload(
            limitReferenceSessions,
            sub.package?.name,
          );

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
          lastSeenAt: new Date(),
        });
        routerAuthSession = await this.sessionRepo.save(newSession);
        routerAuthSessionWasCreated = true;
      } else {
        // Update existing session
        const wasAlreadyActive = existingSessionInSub.isActive;
        routerAuthPreviousState = {
          ipAddress: existingSessionInSub.ipAddress,
          deviceModel: existingSessionInSub.deviceModel,
          isActive: existingSessionInSub.isActive,
        };
        existingSessionInSub.ipAddress = finalIp || existingSessionInSub.ipAddress;
        existingSessionInSub.deviceModel = model;
        existingSessionInSub.isActive = true;
        existingSessionInSub.lastSeenAt = new Date();
        routerAuthSession = await this.sessionRepo.save(existingSessionInSub);
        reusedCurrentActiveSession =
          sub.status === SubscriptionStatus.ACTIVE && wasAlreadyActive;
      }
    }

    if (reusedCurrentActiveSession) {
      await this.persistLatestDeviceIdentity(sub.user, finalMac, finalIp, model);
      const savedSub = await this.subRepo.save(sub);
      this.logger.log(
        `[CONNECT-REUSE] Sub ${savedSub.id} already active for MAC ${finalMac} | IP: ${finalIp || 'none'} | Expires: ${savedSub.expiresAt?.toISOString() || 'pending'}`,
      );
      return {
        ...savedSub,
        handshakeRequired: false,
        activationPending: false,
        connectionConfirmed: true,
        authorizationMode: existingRouterAuthorizationMode || 'active-login',
        resolvedMac: finalMac,
        resolvedIp: finalIp,
      };
    }

    if (sub.status === SubscriptionStatus.ACTIVE && existingRouterAuthorizationMode) {
      await this.persistLatestDeviceIdentity(sub.user, finalMac, finalIp, model);
      const savedSub = await this.subRepo.save(sub);
      this.logger.log(
        `[CONNECT-REUSE] Sub ${savedSub.id} already authorized on router via ${existingRouterAuthorizationMode} | MAC: ${finalMac} | IP: ${finalIp || 'none'} | Expires: ${savedSub.expiresAt?.toISOString() || 'pending'}`,
      );
      return {
        ...savedSub,
        handshakeRequired: false,
        activationPending: false,
        connectionConfirmed: true,
        authorizationMode: existingRouterAuthorizationMode,
        resolvedMac: finalMac,
        resolvedIp: finalIp,
      };
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
          maxAllowed,
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
        const errorMessage = `${e?.message || e}`;
        this.logger.error(`Router Login Failed: ${errorMessage}`);

        if (errorMessage.includes('HOTSPOT_DEVICE_LIMIT_REACHED')) {
          await rollbackRouterAuthSession();
          throw buildDeviceLimitConflict();
        }

        throw new BadRequestException(`Connection Error: ${errorMessage}`);
      }
    }

    const activatedNow = !sub.startedAt;
    if (activatedNow) {
      this.activateSubscriptionClock(sub);
    }

    const savedSub = await this.subRepo.save(sub);
    await this.persistLatestDeviceIdentity(sub.user, finalMac, finalIp, model);

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

  private normalizeMac(mac?: string | null): string {
    return mac ? mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase() : '';
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

    const duration = Number(sub.package.durationValue) || 0;
    const type = sub.package.durationType;
    const expiresAt = new Date(sub.startedAt);
    if (type === DurationType.MINUTES)
      expiresAt.setMinutes(expiresAt.getMinutes() + duration);
    else if (type === DurationType.HOURS)
      expiresAt.setHours(expiresAt.getHours() + duration);
    else if (type === DurationType.DAYS)
      expiresAt.setDate(expiresAt.getDate() + duration);
    else if (type === DurationType.WEEKS)
      expiresAt.setDate(expiresAt.getDate() + duration * 7);
    else if (type === DurationType.MONTHS)
      expiresAt.setMonth(expiresAt.getMonth() + duration);
    sub.expiresAt = expiresAt;
  }

  private async persistLatestDeviceIdentity(
    user: User,
    mac?: string,
    ip?: string,
    deviceModel?: string,
  ) {
    let changed = false;
    if (mac && user.lastMac !== mac) {
      user.lastMac = mac;
      changed = true;
    }
    if (ip && user.lastIp !== ip) {
      user.lastIp = ip;
      changed = true;
    }
    if (deviceModel && user.deviceModel !== deviceModel) {
      user.deviceModel = deviceModel;
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
