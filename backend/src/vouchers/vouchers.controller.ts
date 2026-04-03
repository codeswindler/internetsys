import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('vouchers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VouchersController {
  constructor(
    private readonly vouchersService: VouchersService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('generate')
  generateBatch(@Body() body: { packageId: string; count: number }) {
    return this.vouchersService.generateBatch(body.packageId, body.count);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get()
  findAll() {
    return this.vouchersService.findAll();
  }

  @Post('redeem')
  redeem(
    @Request() req: any,
    @Body() body: { code: string; routerId: string },
  ) {
    // Note: requires SubscriptionsService to be injected
    return this.vouchersService.redeem(
      body.code,
      req.user,
      body.routerId,
      this.subscriptionsService,
    );
  }
}
