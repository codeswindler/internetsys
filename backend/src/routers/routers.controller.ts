import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { RoutersService } from './routers.service';
import { Router } from '../entities/router.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('routers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoutersController {
  constructor(private readonly routersService: RoutersService) {}

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post()
  create(@Body() createDto: Partial<Router>) {
    return this.routersService.create(createDto);
  }

  @Get()
  findAll() {
    return this.routersService.findAll();
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('sync/all-profiles')
  getAllProfiles() {
    return this.routersService.getAllUniqueProfiles();
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('vpn/suggest-ip')
  suggestVpnIp() {
    return this.routersService.suggestVpnIp();
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('vpn/settings')
  getVpnSettings() {
    return this.routersService.getVpnSettings();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routersService.findOne(id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateDto: Partial<Router>) {
    return this.routersService.update(id, updateDto);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.routersService.remove(id);
  }

  @Post(':id/test')
  testConnection(@Param('id') id: string) {
    return this.routersService.testConnection(id);
  }

  @Get(':id/profiles')
  getProfiles(@Param('id') id: string) {
    return this.routersService.getProfiles(id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('profiles/sync')
  syncProfile(
    @Body() body: { name: string; rateLimit: string; routerIds?: string[] },
  ) {
    return this.routersService.createProfileOnAll(
      body.name,
      body.rateLimit,
      body.routerIds,
    );
  }
}
