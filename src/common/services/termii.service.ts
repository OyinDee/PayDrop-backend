import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RedisService } from './redis.service';
import crypto from 'crypto';

export interface OtpVerifyResponse {
  verified: boolean;
  message: string;
}

export interface OtpSendResponse {
  success: boolean;
  message: string;
}

@Injectable()
export class TermiiService {
  private readonly apiKey: string;
  private readonly senderId?: string;
  private readonly baseUrl: string;
  private readonly otpTtlSeconds: number;

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    const key = this.configService.get<string>('TERMII_API_KEY');
    this.apiKey = key || '';
    this.senderId = this.configService.get<string>('TERMII_SENDER_ID');

    this.baseUrl =
      this.configService.get<string>('TERMII_BASE_URL') ||
      'https://v3.api.termii.com';
    this.otpTtlSeconds = Number(
      this.configService.get<string>('OTP_TTL_SECONDS') || 600,
    );

    if (!this.apiKey) {
      throw new Error('TERMII_API_KEY is not configured');
    }
  }

  private generateOtp(length: number = 6): string {
    const digits = '0123456789';
    const bytes = crypto.randomBytes(length);
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[bytes[i] % 10];
    }
    return otp;
  }

  private otpKey(phone: string): string {
    return `otp:${phone}`;
  }

  private otpHash(phone: string, otp: string): string {
    return crypto
      .createHash('sha256')
      .update(`${phone}:${otp}:${this.apiKey}`)
      .digest('hex');
  }

  /**
   * Send OTP to phone number
   */
  async sendOtp(phone: string): Promise<OtpSendResponse> {
    try {
      const otp = this.generateOtp(6);

      await this.redisService.set(
        this.otpKey(phone),
        this.otpHash(phone, otp),
        this.otpTtlSeconds,
      );

      const from = this.senderId;

      const payload: any = {
        to: phone,
        from,
        sms: `Your PayDrop OTP is ${otp}. Valid for ${Math.ceil(this.otpTtlSeconds / 60)} minutes.`,
        type: 'plain',
        api_key: this.apiKey,
        channel: 'generic',
      };

      const response = await axios.post(`${this.baseUrl}/api/sms/send`, payload);

      if (response.data?.status === 'success' || response.status === 200) {
        return {
          success: true,
          message: 'OTP sent successfully',
        };
      }

      const msg = response.data?.message || 'Failed to send OTP';
      throw new BadRequestException(msg);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg =
          (err.response as any)?.data?.message ||
          (err.response as any)?.data?.error ||
          err.message;
        throw new BadRequestException(msg);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException('Failed to send OTP: ' + msg);
    }
  }

  /**
   * Verify OTP submitted by user
   */
  async verifyOtp(phone: string, otp: string): Promise<OtpVerifyResponse> {
    try {
      const stored = await this.redisService.get<string>(this.otpKey(phone));
      if (!stored) {
        return { verified: false, message: 'OTP expired or not found' };
      }

      const computed = this.otpHash(phone, otp);
      const verified = stored === computed;

      if (verified) {
        await this.redisService.del(this.otpKey(phone));
        return { verified: true, message: 'OTP verified successfully' };
      }

      return { verified: false, message: 'Invalid OTP' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException('Failed to verify OTP: ' + msg);
    }
  }
}
