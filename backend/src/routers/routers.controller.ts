import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { RoutersService } from './routers.service';
import { Router } from '../entities/router.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('routers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
export class RoutersController {
  constructor(private readonly routersService: RoutersService) {}

  @Post()
  create(@Body() createDto: Partial<Router>) {
    return this.routersService.create(createDto);
  }

  @Get()
  findAll() {
    return this.routersService.findAll();
  }

  @Get('sync/all-profiles')
  getAllProfiles() {
    return this.routersService.getAllUniqueProfiles();
  }

  @Get('vpn/suggest-ip')
  suggestVpnIp() {
    return this.routersService.suggestVpnIp();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routersService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateDto: Partial<Router>) {
    return this.routersService.update(id, updateDto);
  }

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

  @Post('profiles/sync')
  syncProfile(@Body() body: { name: string; rateLimit: string; routerIds?: string[] }) {
    return this.routersService.createProfileOnAll(body.name, body.rateLimit, body.routerIds);
  }
}
