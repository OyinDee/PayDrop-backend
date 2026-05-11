import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface FraudScoreRequest {
  sender_id: string;
  recipient_id: string;
  amount: number; // kobo
  sender_trust_tier?: string;
  recipient_trust_tier?: string;
  [key: string]: any;
}

interface FraudScoreResponse {
  score: number; // 0-100
  verdict: 'ALLOW' | 'FLAG' | 'BLOCK';
  reason: string;
  features: Record<string, any>;
}

@Injectable()
export class FraudService {
  private client: AxiosInstance;
  private fraudServiceUrl: string;
  private readonly logger = new Logger(FraudService.name);
  private readonly timeout = 3000; // 3 seconds

  constructor(private configService: ConfigService) {
    this.fraudServiceUrl =
      this.configService.get<string>('FRAUD_SERVICE_URL') ||
      'http://localhost:8000';

    this.client = axios.create({
      baseURL: this.fraudServiceUrl,
      timeout: this.timeout,
    });
  }

  /**
   * Score transaction for fraud risk
   * Timeout: 3 seconds. If service DOWN or timeout, returns ALLOW (fail open)
   */
  async scoreTransaction(
    data: FraudScoreRequest,
  ): Promise<FraudScoreResponse> {
    try {
      const response = await this.client.post<FraudScoreResponse>(
        '/score',
        data,
      );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      // Invalid response, default to allow
      this.logger.warn('Invalid fraud score response, defaulting to ALLOW');
      return this.getDefaultResponse('ALLOW');
    } catch (error) {
      // Timeout or service down - fail open
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          this.logger.warn('Fraud service timeout, defaulting to ALLOW');
        } else {
          this.logger.warn(
            `Fraud service error (${error.code}), defaulting to ALLOW`,
          );
        }
      } else {
        this.logger.warn('Unexpected fraud service error, defaulting to ALLOW');
      }

      return this.getDefaultResponse('ALLOW');
    }
  }

  /**
   * Get default response (fail open on errors)
   */
  private getDefaultResponse(verdict: string): FraudScoreResponse {
    return {
      score: 20, // Low default risk
      verdict: verdict as 'ALLOW' | 'FLAG' | 'BLOCK',
      reason: 'Default scoring (service unavailable)',
      features: {},
    };
  }

  /**
   * Health check for fraud service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', {
        timeout: 5000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
