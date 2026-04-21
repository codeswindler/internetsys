import { Controller, Post, Body, Logger } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentMethod } from '../entities/subscription.entity';

@Controller('mpesa')
export class MpesaWebhookController {
  private readonly logger = new Logger(MpesaWebhookController.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('webhook')
  async handleWebhook(@Body() body: any) {
    this.logger.log('Received M-Pesa Webhook: ' + JSON.stringify(body));

    try {
      const result = body.Body?.stkCallback;
      if (!result) return 'OK'; // Ignore malformed requests silently
      const resultCode = `${result.ResultCode ?? ''}`.trim();

      if (resultCode === '0') {
        // Success
        // CheckoutRequestID can be mapped to a subId if we stored it in the DB,
        // but Safaricom also returns the AccountReference inside Item if we passed it there.
        // Actually Daraja Daraja returns AccountReference? No, it returns MpesaReceiptNumber.
        // To properly map, we should store CheckoutRequestID against the Subscription before returning stkPush response.

        // As a fallback/hack for now if DB schema isn't changed:
        // Safaricom sends Phone number in CallbackMetadata.
        // We can just find the most recent 'pending' subscription for this phone number and activate it.
        const meta = result.CallbackMetadata?.Item;
        let phoneStr = '';
        let receipt = '';
        if (meta) {
          meta.forEach((item: any) => {
            if (item.Name === 'PhoneNumber') phoneStr = item.Value?.toString();
            if (item.Name === 'MpesaReceiptNumber')
              receipt = item.Value?.toString();
          });
        }

        if (result.CheckoutRequestID) {
          const activated = await this.subscriptionsService.activateMpesaCheckout(
            result.CheckoutRequestID,
            receipt,
          );
          if (activated) {
            return { ResultCode: 0, ResultDesc: 'Success' };
          }
        }

        if (phoneStr) {
          // Attempt to auto-activate the most recent pending sub for this phone
          await this.subscriptionsService.activatePendingByPhone(
            phoneStr,
            PaymentMethod.MPESA,
            receipt,
          );
        }
      } else {
        this.logger.log(
          `STK Push failed for Checkout ID ${result.CheckoutRequestID}: ${result.ResultDesc}`,
        );
        if (result.CheckoutRequestID) {
          await this.subscriptionsService.failMpesaCheckout(
            result.CheckoutRequestID,
            result,
          );
        }
      }
    } catch (e: any) {
      this.logger.error('Failed to process MPESA webhook: ' + e.message);
    }

    return { ResultCode: 0, ResultDesc: 'Success' };
  }
}
