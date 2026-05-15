import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface FraudScoreRequest {
  /** Required by paydrop-model / FastAPI scorer; aligns with this transfer attempt's idempotency key. */
  idempotency_key: string;
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
  private readonly fraudServiceUrl: string;
  private readonly scorePath = '/score';
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

  private scoreEndpoint(): string {
    const base = this.fraudServiceUrl.replace(/\/$/, '');
    return `${base}${this.scorePath}`;
  }

  private logFraudUnavailable(
    kind: string,
    meta: Record<string, unknown>,
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'fraud_service_unavailable',
        kind,
        env_fraud_service_url: this.fraudServiceUrl,
        request_method: 'POST',
        request_path: this.scorePath,
        request_url: this.scoreEndpoint(),
        timeout_ms: this.timeout,
        hint: 'Set FRAUD_SERVICE_URL to your fraud API base (e.g. https://fraud.internal), or run the local scorer on that host. Fail-open returns ALLOW with score 20.',
        ...meta,
      }),
    );
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
        this.scorePath,
        data,
      );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      this.logFraudUnavailable('invalid_http_response', {
        http_status: response.status,
        body_preview:
          typeof response.data === 'object'
            ? JSON.stringify(response.data).slice(0, 500)
            : String(response.data).slice(0, 200),
      });
      return this.getDefaultResponse('ALLOW');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const kind = (() => {
          if (error.code === 'ECONNABORTED') return 'timeout';
          if (error.code === 'ECONNREFUSED') return 'connection_refused';
          const st = error.response?.status;
          if (st != null && st >= 400 && st < 500) return 'upstream_client_error';
          return 'axios_error';
        })();

        this.logFraudUnavailable(kind, {
          axios_code: error.code,
          axios_message: error.message,
          syscall: (error as NodeJS.ErrnoException)?.syscall,
          errno: (error as NodeJS.ErrnoException)?.errno,
          response_status: error.response?.status,
          response_data:
            error.response?.data != null
              ? JSON.stringify(error.response.data).slice(0, 500)
              : undefined,
        });
      } else {
        this.logFraudUnavailable('non_axios_error', {
          error:
            error instanceof Error ? error.message : String(error),
        });
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
