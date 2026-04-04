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
    // Advanta services endpoint: https://quicksms.advantasms.com/api/services
    const rawUrl = this.configService.get<string>('ADVANTA_BASE_URL') || 'https://quicksms.advantasms.com';
    this.baseUrl = rawUrl.replace(/\/$/, '');
  }

  /**
   * Send OTP via Advanta SMS API
   */
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    const cleanPhone = this.formatPhone(phone);
    // Official OTP endpoint for transactional/OTP messages
    const url = `${this.baseUrl}/api/services/sendotp`;
    const data = {
      apikey: this.apiKey,
      partnerID: this.partnerId,
      mobile: cleanPhone,
      message: `Your PulseLynk code is: ${otp}. Valid for 5 minutes.`,
      shortcode: this.shortCode,
    };

    try {
      this.logger.log(`[SMS] Sending OTP to ${cleanPhone}...`);
      const response = await axios.post(url, data, { timeout: 10000 });
      
      // Official Advanta OTP response is wrapped in 'responses' array
      const success = response.data?.responses?.[0]?.['response-code'] == 200 || response.data?.['response-code'] == 200;
      
      if (success) return true;
      
      this.logger.error(`[SMS] Advanta Error: ${JSON.stringify(response.data)}`);
      return false;
    } catch (e) {
      this.logger.error(`[SMS] Failed to send OTP: ${e.message}`);
      return false;
    }
  }

  /**
   * Send Notification SMS
   */
  async sendSms(phone: string, message: string): Promise<boolean> {
    const cleanPhone = this.formatPhone(phone);
    const url = `${this.baseUrl}/api/services/sendsms`;
    const data = {
      apikey: this.apiKey,
      partnerID: this.partnerId,
      mobile: cleanPhone,
      message: message,
      shortcode: this.shortCode,
    };

    try {
      this.logger.log(`[SMS] Sending Notification...`);
      const response = await axios.post(url, data, { timeout: 10000 });
      
      const success = response.data?.['response-code'] == 200 || response.data?.responses?.[0]?.['response-code'] == 200;
      if (success) return true;
      
      this.logger.error(`[SMS] Advanta Error: ${JSON.stringify(response.data)}`);
      return false;
    } catch (e) {
      this.logger.error(`[SMS] Failed to send SMS: ${e.message}`);
      return false;
    }
  }

  /**
   * Check SMS Balance
   */
  async getBalance(): Promise<number> {
    const url = `${this.baseUrl}/api/services/getbalance`;
    const data = {
      apikey: this.apiKey,
      partnerID: this.partnerId,
    };

    try {
      const response = await axios.post(url, data, { timeout: 10000 });
      if (response.data?.['response-code'] == 200) {
        // Success response uses "credit" field
        return parseFloat(response.data?.credit || '0');
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
