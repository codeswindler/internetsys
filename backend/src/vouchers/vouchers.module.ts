import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { Voucher } from '../entities/voucher.entity';
import { Package } from '../entities/package.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Voucher, Package]),
    SubscriptionsModule,
  ],
  controllers: [VouchersController],
  providers: [VouchersService],
})
export class VouchersModule {}
