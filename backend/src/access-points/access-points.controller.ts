import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminRole } from '../entities/admin.entity';
import { AccessPoint } from '../entities/access-point.entity';
import { AccessPointsService } from './access-points.service';

@Controller('access-points')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
@Permissions('manage_routers')
export class AccessPointsController {
  constructor(private readonly accessPointsService: AccessPointsService) {}

  @Post()
  create(@Body() createDto: Partial<AccessPoint>) {
    return this.accessPointsService.create(createDto);
  }

  @Get()
  findAll() {
    return this.accessPointsService.findAll();
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateDto: Partial<AccessPoint>) {
    return this.accessPointsService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accessPointsService.remove(id);
  }

  @Post(':id/test')
  testConnection(@Param('id') id: string) {
    return this.accessPointsService.testConnection(id);
  }

  @Post(':id/test-kick')
  testKick(@Param('id') id: string, @Body() body: { mac: string }) {
    return this.accessPointsService.testKick(id, body.mac);
  }

  @Post('kick')
  kick(@Body() body: { mac: string; reason?: string }) {
    return this.accessPointsService.disconnectMac(
      body.mac,
      body.reason || 'manual',
    );
  }
}
