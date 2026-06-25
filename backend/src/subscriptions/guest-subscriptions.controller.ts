import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionStatus } from '../entities/subscription.entity';

@Controller('subscriptions/guest')
export class GuestSubscriptionsController {
  constructor(
    private readonly authService: AuthService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get('packages')
  packages() {
    return this.subscriptionsService.listGuestPackages();
  }

  @Get('routers')
  routers() {
    return this.subscriptionsService.listGuestRouters();
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  async checkout(
    @Body()
    body: {
      phone: string;
      packageId: string;
      routerId?: string;
    },
  ) {
    const user = await this.authService.findOrCreateGuestUser(body.phone);
    return this.subscriptionsService.createGuestMpesaCheckout(
      user.id,
      body.packageId,
      body.routerId,
      body.phone,
    );
  }

  @Post('stk-status')
  @HttpCode(HttpStatus.OK)
  async stkStatus(@Body() body: { subId: string; phone: string }) {
    const sub = await this.subscriptionsService.getGuestSubscriptionForPhone(
      body.subId,
      body.phone,
    );
    const status = await this.subscriptionsService.checkStkStatus(body.subId);
    const normalizedStatus = `${status?.status || ''}`.toUpperCase();
    const isPaid =
      status?.success ||
      normalizedStatus === SubscriptionStatus.PAID ||
      normalizedStatus === SubscriptionStatus.ACTIVE;

    return {
      ...status,
      auth: isPaid ? this.authService.buildUserAuthResponse(sub.user) : null,
      sub: await this.subscriptionsService.getGuestSubscriptionPayload(body.subId),
    };
  }
}
