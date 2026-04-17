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
    const rawUrl =
      this.configService.get<string>('ADVANTA_BASE_URL') ||
      'https://quicksms.advantasms.com';
    this.baseUrl = rawUrl.replace(/\/$/, '');
  }

  async sendOtp(phone: string, otp: string, isFlash = false): Promise<boolean> {
    const cleanPhone = this.formatPhone(phone);
    const url = `${this.baseUrl}/api/services/sendotp`;
    const message = this.sanitizeGsm7(
      `Your PulseLynk code is: ${otp}. Valid for 5 minutes.`,
    );

    const data: Record<string, string | number> = {
      apikey: this.apiKey,
      partnerID: this.partnerId,
      mobile: cleanPhone,
      message,
      shortcode: this.shortCode,
    };

    if (isFlash) {
      data.isFlash = 1;
    }

    try {
      this.logger.log(
        `[SMS] Sending OTP | to=${this.maskPhone(cleanPhone)}${isFlash ? ' | flash=true' : ''}`,
      );

      const response = await axios.post(url, data, { timeout: 10000 });
      const responseCode = this.getResponseCode(response.data);
      const responseMessage = this.getResponseMessage(response.data);
      const success = responseCode === '200';

      if (success) {
        this.logger.log(
          `[SMS] OTP accepted | to=${this.maskPhone(cleanPhone)} | code=${responseCode} | detail=${responseMessage}`,
        );
        return true;
      }

      this.logger.error(
        `[SMS] OTP rejected | to=${this.maskPhone(cleanPhone)} | code=${responseCode} | detail=${responseMessage} | payload=${this.stringifyPayload(response.data)}`,
      );
      return false;
    } catch (error: any) {
      this.logger.error(
        `[SMS] OTP request failed | to=${this.maskPhone(cleanPhone)} | ${this.describeAxiosError(error)}`,
      );
      return false;
    }
  }

  async sendSms(phone: string, message: string): Promise<boolean> {
    const cleanPhone = this.formatPhone(phone);
    const url = `${this.baseUrl}/api/services/sendsms`;
    const data = {
      apikey: this.apiKey,
      partnerID: this.partnerId,
      mobile: cleanPhone,
      message: this.sanitizeGsm7(message),
      shortcode: this.shortCode,
    };

    try {
      this.logger.log(
        `[SMS] Sending notification | to=${this.maskPhone(cleanPhone)} | length=${data.message.length}`,
      );

      const response = await axios.post(url, data, { timeout: 10000 });
      const responseCode = this.getResponseCode(response.data);
      const responseMessage = this.getResponseMessage(response.data);
      const success = responseCode === '200';

      if (success) {
        this.logger.log(
          `[SMS] Notification accepted | to=${this.maskPhone(cleanPhone)} | code=${responseCode} | detail=${responseMessage}`,
        );
        return true;
      }

      this.logger.error(
        `[SMS] Notification rejected | to=${this.maskPhone(cleanPhone)} | code=${responseCode} | detail=${responseMessage} | payload=${this.stringifyPayload(response.data)}`,
      );
      return false;
    } catch (error: any) {
      this.logger.error(
        `[SMS] Notification request failed | to=${this.maskPhone(cleanPhone)} | ${this.describeAxiosError(error)}`,
      );
      return false;
    }
  }

  async getBalance(): Promise<number> {
    const url = `${this.baseUrl}/api/services/getbalance`;
    const data = {
      apikey: this.apiKey,
      partnerID: this.partnerId,
    };

    try {
      const response = await axios.post(url, data, { timeout: 10000 });
      const responseCode = this.getResponseCode(response.data);

      if (responseCode === '200') {
        return parseFloat(response.data?.credit || '0');
      }

      this.logger.error(
        `[SMS] Balance rejected | code=${responseCode} | detail=${this.getResponseMessage(response.data)} | payload=${this.stringifyPayload(response.data)}`,
      );
      return 0;
    } catch (error: any) {
      this.logger.error(
        `[SMS] Balance request failed | ${this.describeAxiosError(error)}`,
      );
      return 0;
    }
  }

  public formatPhone(phone: string): string {
    if (!phone) return '';

    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) {
      clean = `254${clean.substring(1)}`;
    }

    return clean;
  }

  private sanitizeGsm7(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[^\x20-\x7E\r\n]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 6) return phone;
    return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
  }

  private getResponseCode(data: any): string {
    return `${data?.['response-code'] ?? data?.responses?.[0]?.['response-code'] ?? 'unknown'}`;
  }

  private getResponseMessage(data: any): string {
    return `${data?.message ?? data?.description ?? data?.['response-description'] ?? data?.responses?.[0]?.message ?? data?.responses?.[0]?.description ?? data?.responses?.[0]?.['response-description'] ?? 'no-detail'}`;
  }

  private stringifyPayload(data: any): string {
    try {
      return JSON.stringify(data).slice(0, 600);
    } catch {
      return '[unserializable-response]';
    }
  }

  private describeAxiosError(error: any): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'none';
      const payload = this.stringifyPayload(error.response?.data);
      return `status=${status} | message=${error.message} | payload=${payload}`;
    }

    return `message=${error?.message || String(error)}`;
  }
}
