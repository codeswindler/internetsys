import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ExpiryJob } from './expiry.job';
import { RouterHealthJob } from './router-health.job';
import { Subscription } from '../entities/subscription.entity';
import { Router } from '../entities/router.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RoutersModule } from '../routers/routers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Router]),
    ScheduleModule.forRoot(),
    SubscriptionsModule,
    RoutersModule,
  ],
  providers: [ExpiryJob, RouterHealthJob],
})
export class SchedulerModule {}
