import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutersController } from './routers.controller';
import { RoutersService } from './routers.service';
import { MikrotikService } from './mikrotik.service';
import { Router } from '../entities/router.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Router])],
  controllers: [RoutersController],
  providers: [RoutersService, MikrotikService],
  exports: [MikrotikService], // Expose MikrotikService to SubscriptionsModule
})
export class RoutersModule {}
