import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class ExpiryJob {
  private readonly logger = new Logger(ExpiryJob.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    private readonly subService: SubscriptionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
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
      } catch (err) {
        this.logger.error(`Failed to expire sub ${sub.id}`, err);
      }
    }
  }
}
