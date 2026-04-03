import { Controller, Get, Post, Body, Param, UseGuards, Request, Ip, Logger } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';
import { PaymentMethod } from '../entities/subscription.entity';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('purchase')
  purchase(@Request() req: any, @Body() body: { packageId: string; routerId: string }) {
    // Only logged in user can purchase for themselves
    return this.subscriptionsService.purchase(req.user.id, body.packageId, body.routerId);
  }

  @Get('my')
  findMy(@Request() req: any) {
    return this.subscriptionsService.findMy(req.user.id);
  }

  @Get('active')
  findActive(@Request() req: any) {
    return this.subscriptionsService.findActive(req.user.id);
  }

  @Get('my/traffic')
  myTraffic(@Request() req: any) {
    return this.subscriptionsService.getTrafficStats(req.user.id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get(':id/traffic')
  trafficForSub(@Param('id') subId: string) {
    return this.subscriptionsService.getTrafficForSub(subId);
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Body() body: { mac?: string, ip?: string }, @Ip() clientIp: string, @Request() req: any) {
    this.logger.log(`[DIAGNOSTIC] START REQUEST RECEIVED for sub ${id}. MAC: ${body.mac}, IP: ${body.ip}, ClientIP: ${clientIp}`);
    const finalIp = body.ip || clientIp;
    const userAgent = req.headers['user-agent'];
    return this.subscriptionsService.startSession(id, body.mac, finalIp, userAgent);
  }

  // Admins can activate pending manual subscriptions
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post(':id/activate')
  activate(@Param('id') subId: string, @Body() body: { paymentMethod: any, paymentRef?: string }) {
    return this.subscriptionsService.activate(subId, body.paymentMethod, body.paymentRef);
  }

  // Admins can directly allocate a package to a user (creates + activates immediately)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post('allocate')
  allocate(@Body() body: { userId: string; packageId: string; routerId: string }) {
    return this.subscriptionsService.allocate(body.userId, body.packageId, body.routerId);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.subscriptionsService.cancelSubscription(id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.subscriptionsService.reactivateSubscription(id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get()
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Post('stk-push')
  async stkPush(@Request() req: any, @Body() body: { subId: string }) {
    // 1. Simulate STK Push to the user's phone
    this.subscriptionsService['logger'].log(`Triggering STK Push for sub ${body.subId}...`);
    
    // 2. Delay to simulate user entering pin
    await new Promise(r => setTimeout(r, 2000));
    
    // 3. Activate as MPESA
    return this.subscriptionsService.activate(body.subId, PaymentMethod.MPESA, `SIM_${Math.random().toString(36).substring(7).toUpperCase()}`);
  }
}

