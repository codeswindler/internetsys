import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Request,
  Param,
  Ip,
} from '@nestjs/common';
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
    const identifier =
      body.identifier || body.phone || body.email || body.username;
    return this.authService.userLogin(identifier, body.password);
  }

  // --- 📲 OTP FLOWS (ADVANTA SMS INTEGRATION) ---

  @Post('user/request-otp')
  @HttpCode(HttpStatus.OK)
  requestUserOtp(@Body() body: { phone: string }) {
    return this.authService.requestUserOtp(body.phone);
  }

  @Post('user/login-otp')
  @HttpCode(HttpStatus.OK)
  loginUserOtp(@Body() body: { phone: string; code: string }) {
    return this.authService.loginWithUserOtp(body.phone, body.code);
  }

  @Post('admin/request-otp')
  @HttpCode(HttpStatus.OK)
  requestAdminOtp(@Body() body: { identifier: string; password?: string }) {
    return this.authService.requestAdminOtp(body.identifier, body.password || '');
  }

  @Post('admin/login-otp')
  @HttpCode(HttpStatus.OK)
  loginAdminOtp(@Body() body: { adminId: string; code: string }) {
    return this.authService.verifyAdminOtpAndLogin(body.adminId, body.code);
  }

  @Post('user/register')
  userRegister(@Body() body: any) {
    return this.authService.userRegister(
      body.name,
      body.phone,
      body.password,
      body.username,
    );
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

  @UseGuards(JwtAuthGuard)
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  updateProfileLegacy(@Request() req: any, @Body() body: any) {
    // Some clients use POST to update profile, alias to put
    return this.authService.updateProfile(
      req.user.id,
      req.user.role || 'user',
      body,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/update')
  @HttpCode(HttpStatus.OK)
  updateProfileAlias(@Request() req: any, @Body() body: any) {
    return this.authService.updateProfile(
      req.user.id,
      req.user.role || 'user',
      body,
    );
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
    return this.authService.adminCreateUser(
      body.name,
      body.phone,
      body.password,
      body.username,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('admin/users/:id/toggle')
  toggleUserStatus(@Param('id') id: string) {
    return this.authService.toggleUserStatus(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('admin/users/:id/password')
  adminResetUserPassword(@Param('id') id: string, @Body() body: any) {
    return this.authService.adminResetUserPassword(id, body.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('admin/users/:id/reset-password')
  adminAutoResetPassword(@Param('id') id: string) {
    return this.authService.adminAutoResetUserPassword(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('admin/users/:id/delete')
  deleteUserAlias(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }

  // Adding actual HTTP verb decorators for the best REST compliance
  @UseGuards(JwtAuthGuard)
  @Post('profile')
  updateProfilePost(@Request() req: any, @Body() body: any) {
    return this.authService.updateProfile(
      req.user.id,
      req.user.role || 'user',
      body,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Request() req: any,
    @Body() body: { mac?: string; ip?: string },
    @Ip() clientIp: string,
  ) {
    if (req.user.role && req.user.role !== 'user') return { success: true };
    const finalIp = body.ip || clientIp;
    return this.authService.heartbeat(req.user.id, body.mac, finalIp);
  }
}
