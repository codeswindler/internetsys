import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { Package } from '../entities/package.entity';
import { Subscription } from '../entities/subscription.entity';
import { Voucher } from '../entities/voucher.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Package, Subscription, Voucher])],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
