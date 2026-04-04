import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly partnerId: string;
  private readonly apiKey: string;
  private readonly shortCode: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.partnerId = this.configService.get<string>('ADVANTA_PARTNER_ID') || '';
    this.apiKey = this.configService.get<string>('ADVANTA_API_KEY') || '';
    this.shortCode = this.configService.get<string>('ADVANTA_SHORTCODE') || '';
    // Normalize baseUrl: strip trailing slash if present
    const rawUrl = this.configService.get<string>('ADVANTA_BASE_URL') || 'https://quicksms.advantasms.com/api/v2';
    this.baseUrl = rawUrl.replace(/\/$/, '');
  }

  /**
   * Send OTP via Advanta SMS API
   * Ref: https://developers.advantasms.com/sms-api/send-otp.html
   */
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    const cleanPhone = this.formatPhone(phone);
    // Use standard SendSMS for v2 OTP delivery
    const url = `${this.baseUrl}/SendSMS`;
    const data = {
      partnerID: this.partnerId,
      apikey: this.apiKey,
      mobile: cleanPhone,
      shortcode: this.shortCode,
      message: `Your PulseLynk code is: ${otp}. Valid for 5 minutes.`,
    };

    try {
      this.logger.log(`[SMS] Sending OTP to ${cleanPhone}...`);
      const response = await axios.post(url, data);
      
      // Advanta v2 returns "response-code": "200" for success
      if (response.data?.['response-code'] == 200) {
        return true;
      }
      
      this.logger.error(`[SMS] Advanta Error: ${JSON.stringify(response.data)}`);
      return false;
    } catch (e) {
      this.logger.error(`[SMS] Failed to send OTP: ${e.message}`);
      return false;
    }
  }

  /**
   * Send Bulk SMS for notifications
   */
  async sendSms(phone: string, message: string): Promise<boolean> {
    const cleanPhone = this.formatPhone(phone);
    const url = `${this.baseUrl}/SendSMS`;
    const data = {
      partnerID: this.partnerId,
      apikey: this.apiKey,
      mobile: cleanPhone,
      shortcode: this.shortCode,
      message: message,
    };

    try {
      this.logger.log(`[SMS] Sending Notification to ${cleanPhone}...`);
      const response = await axios.post(url, data);
      
      if (response.data?.['response-code'] == 200) {
        return true;
      }
      
      this.logger.error(`[SMS] Advanta Error (Sms): ${JSON.stringify(response.data)}`);
      return false;
    } catch (e) {
      this.logger.error(`[SMS] Failed to send SMS: ${e.message}`);
      return false;
    }
  }

  /**
   * Check SMS Balance
   * Ref: https://developers.advantasms.com/sms-api/balance.html
   */
  async getBalance(): Promise<number> {
    const url = `${this.baseUrl}/Balance`;
    const data = {
      partnerID: this.partnerId,
      apikey: this.apiKey,
    };

    try {
      const response = await axios.post(url, data);
      if (response.data?.['response-code'] == 200) {
        // Return only the credit balance
        return parseFloat(response.data?.credit_balance || '0');
      }
      this.logger.error(`[SMS] Balance failed: ${JSON.stringify(response.data)}`);
      return 0;
    } catch (e) {
      this.logger.error(`[SMS] Balance Check Failed: ${e.message}`);
      return 0;
    }
  }

  private formatPhone(phone: string): string {
    // Advanta requires 254... format for Kenya
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) {
      clean = '254' + clean.substring(1);
    } else if (clean.startsWith('+')) {
      clean = clean.substring(1);
    }
    return clean;
  }
}
