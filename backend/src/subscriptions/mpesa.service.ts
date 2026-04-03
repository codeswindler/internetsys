import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  // Credentials from Environment
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

  // For production, change to api.safaricom.co.ke
  private readonly baseUrl = 'https://sandbox.safaricom.co.ke';

  async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`,
    ).toString('base64');
    const response = await axios.get(
      `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      },
    );
    return response.data.access_token;
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

    // Format phone number: must start with 254
    let formattedPhone = phone.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }

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
      `Initiating STK Push to ${formattedPhone} for KES ${amount}`,
    );

    const response = await axios.post(
      `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.data;
  }

  private getTimestamp(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    const hour = ('0' + date.getHours()).slice(-2);
    const minute = ('0' + date.getMinutes()).slice(-2);
    const second = ('0' + date.getSeconds()).slice(-2);
    return `${year}${month}${day}${hour}${minute}${second}`;
  }
}
