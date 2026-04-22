import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, MoreThan, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class ExpiryJob {
  private readonly logger = new Logger(ExpiryJob.name);
  private isRunning = false;

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    private readonly subService: SubscriptionsService,
    private readonly smsService: SmsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleExpiry() {
    if (this.isRunning) {
      this.logger.warn(
        'Skipping subscription expiry check because a previous run is still in progress.',
      );
      return;
    }

    this.isRunning = true;
    this.logger.debug('Running subscription expiry check...');
    let hasDatabaseLock = false;

    try {
      const lockResult = await this.subRepo.query(
        'SELECT GET_LOCK(?, 0) AS lockStatus',
        ['pulselynk_expiry_job'],
      );
      hasDatabaseLock = Number(lockResult?.[0]?.lockStatus || 0) === 1;

      if (!hasDatabaseLock) {
        this.logger.warn(
          'Skipping subscription expiry check because another app instance holds the scheduler lock.',
        );
        return;
      }

      const now = new Date();

      const expiredSubs = await this.subRepo.find({
        where: {
          status: SubscriptionStatus.ACTIVE,
          expiresAt: LessThan(now),
        },
      });

      for (const sub of expiredSubs) {
        try {
          await this.subService.expireSubscription(sub.id);
          this.logger.log(`Expired subscription ${sub.id}`);
        } catch (err) {
          this.logger.error(`Failed to handle expiry logic for sub ${sub.id}`, err);
        }
      }

      const finalNudgeSubs = await this.subRepo.find({
        where: {
          status: SubscriptionStatus.EXPIRED,
          finalExpiryNotified: false,
          updatedAt: MoreThan(new Date(now.getTime() - 2 * 60000)),
        },
        relations: ['user', 'package'],
      });

      for (const sub of finalNudgeSubs) {
        if (!sub.user?.phone || sub.user.phone.length < 9) {
          sub.finalExpiryNotified = true;
          await this.subRepo.save(sub);
          continue;
        }

        try {
          const msg = `PulseLynk: Your subscription has ended. Choose a new plan to continue browsing. If the sign in portal does not appear, reconnect to the Wi-Fi network and try again.`;
          const success = await this.smsService.sendSms(sub.user.phone, msg);
          if (success) {
            sub.finalExpiryNotified = true;
            await this.subRepo.save(sub);
            this.logger.log(`Sent final expiry nudge to ${sub.user.phone}`);
          }
        } catch (err) {
          this.logger.error(`Failed to send final expiry nudge for sub ${sub.id}`, err);
        }
      }

      const warningLowerBound = new Date(now.getTime() + 14 * 60000);
      const warningUpperBound = new Date(now.getTime() + 15 * 60000);
      const warningSubs = await this.subRepo.find({
        where: {
          status: SubscriptionStatus.ACTIVE,
          expiresAt: Between(warningLowerBound, warningUpperBound),
          expiryNotified: false,
        },
        relations: ['user', 'package'],
      });

      for (const sub of warningSubs) {
        if (!sub.user?.phone || sub.user.phone.length < 9) {
          sub.expiryNotified = true;
          await this.subRepo.save(sub);
          continue;
        }

        if (sub.expiresAt && sub.expiresAt > new Date()) {
          try {
            const timeLeft = Math.ceil(
              (sub.expiresAt.getTime() - Date.now()) / 60000,
            );
            const msg = `PulseLynk Alert: Your ${sub.package?.name} plan expires in ${timeLeft} minutes. Buy a new package to stay connected!`;

            const success = await this.smsService.sendSms(sub.user.phone, msg);
            if (success) {
              sub.expiryNotified = true;
              await this.subRepo.save(sub);
              this.logger.log(`Sent 15m expiry warning to ${sub.user.phone}`);
            }
          } catch (err) {
            this.logger.error(`Failed to send expiry warning to sub ${sub.id}`, err);
          }
        }
      }
    } finally {
      if (hasDatabaseLock) {
        try {
          await this.subRepo.query('SELECT RELEASE_LOCK(?)', [
            'pulselynk_expiry_job',
          ]);
        } catch (e: any) {
          this.logger.warn(
            `Failed to release expiry scheduler lock: ${e.message}`,
          );
        }
      }

      this.isRunning = false;
    }
  }
}
