import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Request, Param } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRole } from '../entities/admin.entity';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('admin/login')
  adminLogin(@Body() body: any) {
    const identifier = body.identifier || body.email || body.username;
    return this.authService.adminLogin(identifier, body.password);
  }

  @HttpCode(HttpStatus.OK)
  @Post('user/login')
  userLogin(@Body() body: any) {
    const identifier = body.identifier || body.phone || body.email || body.username;
    return this.authService.userLogin(identifier, body.password);
  }

  @Post('user/register')
  userRegister(@Body() body: any) {
    return this.authService.userRegister(body.name, body.phone, body.password, body.username);
  }

  // Setup initial admin for testing
  @Post('admin/setup')
  setupAdmin(@Body() body: any) {
    return this.authService.createInitialAdmin(body.email, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id, req.user.role || 'user');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('admin/users')
  getAllUsers() {
    return this.authService.getAllUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('admin/users')
  adminCreateUser(@Body() body: any) {
    return this.authService.adminCreateUser(body.name, body.phone, body.password, body.username);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('admin/users/:id/toggle')
  toggleUserStatus(@Param('id') id: string) {
    return this.authService.toggleUserStatus(id);
  }
}
