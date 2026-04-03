import { Controller, Get, Post, Body, Param, UseGuards, Request, Ip, Logger } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { MpesaService } from './mpesa.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';
import { PaymentMethod } from '../entities/subscription.entity';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly mpesaService: MpesaService,
  ) {}

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

  @Get('recent')
  findRecent(@Request() req: any) {
    return this.subscriptionsService.findRecent(req.user.id);
  }

  @Get('active-all')
  findActiveAll(@Request() req: any) {
    return this.subscriptionsService.findAllActive(req.user.id);
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

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('pending-count')
  countPending() {
    return this.subscriptionsService.countPending();
  }

  @Post('stk-push')
  async stkPush(@Request() req: any, @Body() body: { subId: string, phone: string, amount: number }) {
    this.logger.log(`Triggering STK Push for sub ${body.subId} with phone ${body.phone}...`);

    try {
      // 1. Trigger STK Push to the user's phone via Daraja API
      const mpesaRes = await this.mpesaService.stkPush(
        body.phone,
        body.amount,
        `SUB-${body.subId.substring(0, 8)}`,
        'Internet Subscription'
      );

      // The subscription stays pending for now, wait for callback webhook to hit to activate it.
      // But if Daraja isn't setup fully, you might still want manual fallback.
      return { success: true, message: 'STK push sent', daraja: mpesaRes };
    } catch (e: any) {
      this.logger.error('Daraja STK push failed: ' + e?.response?.data?.errorMessage || e.message);
      throw e;
    }
  }
}

