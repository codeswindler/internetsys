import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SmsService } from '../sms/sms.service';
import { MoreThan } from 'typeorm';

@Injectable()
export class ExpiryJob {
  private readonly logger = new Logger(ExpiryJob.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    private readonly subService: SubscriptionsService,
    private readonly smsService: SmsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleExpiry() {
    this.logger.debug('Running subscription expiry check...');

    // Find all active subscriptions where expiresAt is in the past
    const expiredSubs = await this.subRepo.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        expiresAt: LessThan(new Date()),
      },
    });

    for (const sub of expiredSubs) {
      try {
        await this.subService.expireSubscription(sub.id);
        this.logger.log(`Expired subscription ${sub.id}`);

        // --- 📲 FINAL EXPIRY NUDGE ---
        const fullSub = await this.subRepo.findOne({ 
          where: { id: sub.id }, 
          relations: ['user', 'package'] 
        });
        
        if (fullSub?.user?.phone && fullSub.user.phone.length >= 9) {
          const msg = `PulseLynk: Your ${fullSub.package?.name} plan has expired. To continue browsing, please purchase a new package.`;
          await this.smsService.sendSms(fullSub.user.phone, msg);
          this.logger.log(`Sent final expiry nudge to ${fullSub.user.phone}`);
        }
      } catch (err) {
        this.logger.error(`Failed to handle expiry logic for sub ${sub.id}`, err);
      }
    }

    // --- 📲 15-MINUTE EXPIRY WARNING (ADVANTA) ---
    const warningThreshold = new Date(Date.now() + 15 * 60000); // 15 mins from now
    const warningSubs = await this.subRepo.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        expiresAt: LessThan(warningThreshold),
        expiryNotified: false,
      },
      relations: ['user', 'package'],
    });

    for (const sub of warningSubs) {
      // Ensure we haven't already passed the expiry time (which is handled above)
      if (sub.expiresAt && sub.expiresAt > new Date()) {
        try {
          const timeLeft = Math.round((sub.expiresAt.getTime() - Date.now()) / 60000);
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
  }
}
