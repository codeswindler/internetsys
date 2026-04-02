import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus, PaymentMethod } from '../entities/subscription.entity';
import { Package, DurationType } from '../entities/package.entity';
import { User } from '../entities/user.entity';
import { Router } from '../entities/router.entity';
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
    private mikrotikService: MikrotikService,
    private transactionsService: TransactionsService,
  ) {}

  async purchase(userId: string, packageId: string, routerId: string): Promise<Subscription> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const pkg = await this.pkgRepo.findOne({ where: { id: packageId, isActive: true } });
    if (!pkg) throw new NotFoundException('Package not found or inactive');

    const router = await this.routerRepo.findOne({ where: { id: routerId, isOnline: true } });
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

  async activate(subId: string, paymentMethod: PaymentMethod, paymentRef?: string): Promise<Subscription> {
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
        await this.mikrotikService.createPppoeSecret(sub.router, username, password, sub.package.bandwidthProfile);
      } else {
        await this.mikrotikService.createHotspotUser(sub.router, username, password, sub.package.bandwidthProfile);
      }
    } catch (error: any) {
      this.logger.error(`Activation failed for sub ${subId}: ${error.message || JSON.stringify(error)}`);
      throw new BadRequestException(`MikroTik Error: ${error.message || JSON.stringify(error)}`);
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
    if (paymentMethod === PaymentMethod.MPESA) txMethod = TransactionMethod.MPESA_STK;
    if (paymentMethod === PaymentMethod.VOUCHER) txMethod = TransactionMethod.VOUCHER;

    await this.transactionsService.log({
      user: sub.user,
      package: sub.package,
      amount: sub.amountPaid,
      method: txMethod,
      reference: paymentRef,
      notes: paymentMethod === PaymentMethod.MANUAL ? 'Administrator manual allocation' : undefined,
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

  async findAll(): Promise<Subscription[]> {
    return this.subRepo.find({
      relations: ['package', 'router', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async allocate(userId: string, packageId: string, routerId: string): Promise<Subscription> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const pkg = await this.pkgRepo.findOne({ where: { id: packageId, isActive: true } });
    if (!pkg) throw new NotFoundException('Package not found or inactive');

    const router = await this.routerRepo.findOne({ where: { id: routerId, isOnline: true } });
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
          await this.mikrotikService.removePppoeSecret(sub.router, sub.mikrotikUsername);
        } else {
          await this.mikrotikService.removeHotspotUser(sub.router, sub.mikrotikUsername);
        }
      } catch (e) {
        this.logger.error(`Failed to remove user on expire for sub ${subId}`, e);
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
      throw new BadRequestException(`Cannot cancel a subscription in ${sub.status} state`);
    }

    // Remove from MikroTik
    if (sub.mikrotikUsername) {
      try {
        if (sub.router.connectionMode === 'pppoe') {
          await this.mikrotikService.removePppoeSecret(sub.router, sub.mikrotikUsername);
        } else {
          await this.mikrotikService.removeHotspotUser(sub.router, sub.mikrotikUsername);
        }
      } catch (e) {
        this.logger.warn(`MikroTik cleanup failed for sub ${subId}: ${e.message}`);
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
      throw new BadRequestException(`Can only reactivate a cancelled subscription, current state: ${sub.status}`);
    }

    // Re-create on MikroTik with same credentials
    try {
      if (sub.router.connectionMode === 'pppoe') {
        await this.mikrotikService.createPppoeSecret(sub.router, sub.mikrotikUsername, sub.mikrotikPassword, sub.package.bandwidthProfile);
      } else {
        await this.mikrotikService.createHotspotUser(sub.router, sub.mikrotikUsername, sub.mikrotikPassword, sub.package.bandwidthProfile);
      }
    } catch (e) {
      throw new BadRequestException(`MikroTik Error on reactivation: ${e.message}`);
    }

    // Calculate new expiry
    const now = new Date();
    const expiresAt = new Date(now);
    const durationCount = sub.package.durationValue;
    switch (sub.package.durationType) {
      case DurationType.MINUTES: expiresAt.setMinutes(expiresAt.getMinutes() + durationCount); break;
      case DurationType.HOURS: expiresAt.setHours(expiresAt.getHours() + durationCount); break;
      case DurationType.DAYS: expiresAt.setDate(expiresAt.getDate() + durationCount); break;
      case DurationType.WEEKS: expiresAt.setDate(expiresAt.getDate() + (durationCount * 7)); break;
      case DurationType.MONTHS: expiresAt.setMonth(expiresAt.getMonth() + durationCount); break;
    }

    sub.status = SubscriptionStatus.ACTIVE;
    sub.startedAt = now;
    sub.expiresAt = expiresAt;
    
    return this.subRepo.save(sub);
  }

  async startSession(subId: string, mac?: string, ip?: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id: subId },
      relations: ['package', 'router', 'user'],
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException(`Subscription is in ${sub.status} state, cannot start`);
    }

    // Fallback to saved user metadata if not provided
    let finalMac = mac || sub.user.lastMac;
    const finalIp = ip || sub.user.lastIp;

    // IF MAC is STILL missing, try looking it up on the router using the IP
    if (!finalMac && finalIp) {
      try {
        const foundMac = await this.mikrotikService.findMacByIp(sub.router, finalIp);
        if (foundMac) {
          finalMac = foundMac;
          // Store it for next time
          sub.user.lastMac = foundMac;
          await this.userRepo.save(sub.user);
        }
      } catch (e) {
        this.logger.warn(`MAC lookup by IP failed: ${e.message}`);
      }
    }

    // Attempt direct login if mac/ip are available
    if (finalMac || finalIp) {
      try {
        await this.mikrotikService.loginUser(
          sub.router,
          sub.mikrotikUsername,
          sub.mikrotikPassword,
          finalIp,
          finalMac
        );
      } catch (e) {
        this.logger.warn(`Failed to inject active session for ${sub.id}: ${e.message}`);
      }
    }

    // Only start if it hasn't started yet
    if (sub.startedAt) {
      return sub;
    }

    const now = new Date();
    const expiresAt = new Date(now);
    const durationCount = sub.package.durationValue;
    
    switch (sub.package.durationType) {
      case DurationType.MINUTES: expiresAt.setMinutes(expiresAt.getMinutes() + durationCount); break;
      case DurationType.HOURS: expiresAt.setHours(expiresAt.getHours() + durationCount); break;
      case DurationType.DAYS: expiresAt.setDate(expiresAt.getDate() + durationCount); break;
      case DurationType.WEEKS: expiresAt.setDate(expiresAt.getDate() + (durationCount * 7)); break;
      case DurationType.MONTHS: expiresAt.setMonth(expiresAt.getMonth() + durationCount); break;
    }

    sub.startedAt = now;
    sub.expiresAt = expiresAt;
    
    return this.subRepo.save(sub);
  }
}
