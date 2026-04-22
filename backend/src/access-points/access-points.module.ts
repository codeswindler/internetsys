import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessPoint } from '../entities/access-point.entity';
import { AccessPointsController } from './access-points.controller';
import { AccessPointsService } from './access-points.service';

@Module({
  imports: [TypeOrmModule.forFeature([AccessPoint])],
  controllers: [AccessPointsController],
  providers: [AccessPointsService],
  exports: [AccessPointsService],
})
export class AccessPointsModule {}
