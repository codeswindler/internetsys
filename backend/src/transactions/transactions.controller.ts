import { Controller, Get, UseGuards } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get()
  findAll() {
    return this.transactionsService.findAll();
  }
}
