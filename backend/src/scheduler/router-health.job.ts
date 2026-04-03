import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Router } from '../entities/router.entity';
import { MikrotikService } from '../routers/mikrotik.service';

@Injectable()
export class RouterHealthJob {
  private readonly logger = new Logger(RouterHealthJob.name);

  constructor(
    @InjectRepository(Router)
    private readonly routerRepo: Repository<Router>,
    private readonly mikrotikService: MikrotikService,
  ) {}

  @Cron('0 */5 * * * *') // Every 5 minutes
  async checkHealth() {
    this.logger.debug('Running router health check...');

    const routers = await this.routerRepo.find();
    for (const router of routers) {
      const result = await this.mikrotikService.testConnection(router);
      const isOnline = result.success;

      if (router.isOnline !== isOnline) {
        this.logger.log(
          `Router ${router.host} state changed from ${router.isOnline} to ${isOnline}`,
        );
      }

      router.isOnline = isOnline;
      router.lastCheckedAt = new Date();
      await this.routerRepo.save(router);
    }
  }
}
