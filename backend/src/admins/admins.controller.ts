import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AdminsService } from './admins.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';

@Controller('admins')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRole.SUPERADMIN) // Still only superadmins can manage other admins by default
export class AdminsController {
  private readonly logger = new Logger(AdminsController.name);
  constructor(private readonly adminsService: AdminsService) {}

  @Permissions('manage_admins')
  @Get()
  async findAll() {
    return this.adminsService.findAll();
  }

  @Get('permissions')
  async findAllPermissions() {
    return this.adminsService.findAllPermissions();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.adminsService.findOne(id);
  }

  @Post()
  async create(@Body() data: any) {
    return this.adminsService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.adminsService.update(id, data);
  }

  @Post('seed')
  async seed() {
    await this.adminsService.onModuleInit();
    return { success: true, message: 'Permissions seeded' };
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    return this.adminsService.resetCredentials(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.adminsService.delete(id);
  }
}
