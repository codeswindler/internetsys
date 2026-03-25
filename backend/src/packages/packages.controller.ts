import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { Package } from '../entities/package.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('packages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post()
  create(@Body() createDto: Partial<Package>) {
    return this.packagesService.create(createDto);
  }

  // Users and Admins can view active packages
  @Get()
  findAll() {
    return this.packagesService.findAll(true);
  }

  // Admins can view all packages including inactive ones
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('all')
  findAllAdmin() {
    return this.packagesService.findAll(false);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packagesService.findOne(id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateDto: Partial<Package>) {
    return this.packagesService.update(id, updateDto);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.packagesService.remove(id);
  }
}
