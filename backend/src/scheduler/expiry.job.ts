import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, Repository } from 'typeorm';
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

    try {
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
          const msg = `PulseLynk: Your ${sub.package?.name} plan has expired. To continue browsing, please purchase a new package.`;
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
      this.isRunning = false;
    }
  }
}
