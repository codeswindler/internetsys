import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  private get consumerKey() {
    return process.env.MPESA_CONSUMER_KEY;
  }

  private get consumerSecret() {
    return process.env.MPESA_CONSUMER_SECRET;
  }

  private get passkey() {
    return process.env.MPESA_PASSKEY;
  }

  private get shortcode() {
    return process.env.MPESA_SHORTCODE;
  }

  private get callbackUrl() {
    return process.env.MPESA_CALLBACK_URL;
  }

  private get baseUrl() {
    return process.env.MPESA_ENV === 'sandbox'
      ? 'https://sandbox.safaricom.co.ke'
      : 'https://api.safaricom.co.ke';
  }

  async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`,
    ).toString('base64');

    try {
      const response = await axios.get(
        `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
          },
          timeout: 10000,
        },
      );

      const token = response.data?.access_token;
      if (!token) {
        throw new Error('Access token missing from Safaricom response');
      }

      return token;
    } catch (error: any) {
      this.logger.error(
        `[MPESA] Access token request failed | ${this.describeAxiosError(error)}`,
      );
      throw new BadGatewayException(
        'Safaricom authorization failed. Please retry shortly.',
      );
    }
  }

  async stkPush(
    phone: string,
    amount: number,
    accountReference: string,
    transactionDesc: string,
  ): Promise<any> {
    const accessToken = await this.getAccessToken();
    const timestamp = this.getTimestamp();
    const password = Buffer.from(
      `${this.shortcode}${this.passkey}${timestamp}`,
    ).toString('base64');
    const formattedPhone = this.formatPhone(phone);

    const payload = {
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(amount),
      PartyA: formattedPhone,
      PartyB: this.shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: this.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
    };

    this.logger.log(
      `[MPESA] Initiating STK push | phone=${this.maskPhone(formattedPhone)} | amount=${Math.ceil(amount)} | accountRef=${accountReference}`,
    );

    try {
      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 10000,
        },
      );

      this.logger.log(
        `[MPESA] STK push accepted | checkout=${response.data?.CheckoutRequestID || 'unknown'} | merchant=${response.data?.MerchantRequestID || 'unknown'} | code=${response.data?.ResponseCode || 'unknown'} | detail=${response.data?.ResponseDescription || response.data?.CustomerMessage || 'no-detail'}`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `[MPESA] STK push failed | phone=${this.maskPhone(formattedPhone)} | ${this.describeAxiosError(error)}`,
      );
      throw new BadGatewayException(
        'Safaricom STK push failed. Please try again.',
      );
    }
  }

  async queryStkStatus(checkoutRequestId: string): Promise<any> {
    const accessToken = await this.getAccessToken();
    const timestamp = this.getTimestamp();
    const password = Buffer.from(
      `${this.shortcode}${this.passkey}${timestamp}`,
    ).toString('base64');

    const payload = {
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 10000,
        },
      );

      this.logger.log(
        `[MPESA] STK query response | checkout=${checkoutRequestId} | result=${response.data?.ResultCode || 'unknown'} | detail=${response.data?.ResultDesc || 'no-detail'} | requestId=${response.data?.requestId || response.headers?.['x-request-id'] || 'n/a'}`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `[MPESA] STK query failed | checkout=${checkoutRequestId} | ${this.describeAxiosError(error)}`,
      );
      throw new BadGatewayException(
        'Safaricom STK query is temporarily unavailable. Please retry shortly.',
      );
    }
  }

  private formatPhone(phone: string): string {
    let formattedPhone = phone.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = `254${formattedPhone.substring(1)}`;
    } else if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }

    return formattedPhone;
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 6) return phone;
    return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
  }

  private describeAxiosError(error: any): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'none';
      const requestId =
        error.response?.data?.requestId ||
        error.response?.headers?.['x-request-id'] ||
        'n/a';
      const errorCode = error.response?.data?.errorCode || error.code || 'none';
      const detail =
        error.response?.data?.errorMessage ||
        error.response?.data?.ResponseDescription ||
        error.message;

      return `status=${status} | requestId=${requestId} | code=${errorCode} | detail=${detail}`;
    }

    return `message=${error?.message || String(error)}`;
  }

  private getTimestamp(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = (`0${date.getMonth() + 1}`).slice(-2);
    const day = (`0${date.getDate()}`).slice(-2);
    const hour = (`0${date.getHours()}`).slice(-2);
    const minute = (`0${date.getMinutes()}`).slice(-2);
    const second = (`0${date.getSeconds()}`).slice(-2);
    return `${year}${month}${day}${hour}${minute}${second}`;
  }
}
