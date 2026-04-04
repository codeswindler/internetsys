import { Controller, Get, UseGuards, Logger } from '@nestjs/common';
import { SmsService } from './sms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('sms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmsController {
  private readonly logger = new Logger(SmsController.name);
  constructor(private readonly smsService: SmsService) {}

  @Get('balance')
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  async getBalance() {
    return { balance: await this.smsService.getBalance() };
  }
}
