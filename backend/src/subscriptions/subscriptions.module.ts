import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsController } from './subscriptions.controller';
import { MpesaWebhookController } from './mpesa-webhook.controller';
import { SubscriptionsService } from './subscriptions.service';
import { MpesaService } from './mpesa.service';
import { Subscription } from '../entities/subscription.entity';
import { Package } from '../entities/package.entity';
import { User } from '../entities/user.entity';
import { Router } from '../entities/router.entity';
import { RoutersModule } from '../routers/routers.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Package, User, Router]),
    RoutersModule, // To use MikrotikService
    TransactionsModule,
  ],
  controllers: [SubscriptionsController, MpesaWebhookController],
  providers: [SubscriptionsService, MpesaService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
