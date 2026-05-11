import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class SquadService {
  private client: AxiosInstance;
  private secretKey: string | undefined;
  private webhookSecret: string | undefined;
  private testBvn: string | undefined;
  private testDob: string | undefined;
  private beneficiaryAccount: string | undefined;
  private beneficiaryBankCode: string | undefined;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('SQUAD_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('SQUAD_WEBHOOK_SECRET');
    this.testBvn = this.configService.get<string>('SQUAD_TEST_BVN') || '22110011001';
    this.testDob = normalizeDobToMmDdYyyy(
      this.configService.get<string>('SQUAD_TEST_DOB') || '10/30/1990',
    );
    this.beneficiaryAccount = this.configService.get<string>(
      'SQUAD_BENEFICIARY_ACCOUNT',
    );
    this.beneficiaryBankCode = this.configService.get<string>(
      'SQUAD_BENEFICIARY_BANK_CODE',
    );

    const baseURL = this.configService.get<string>('SQUAD_BASE_URL') ||
      'https://sandbox-api-d.squadco.com';

    if (!this.secretKey || !this.webhookSecret) {
      throw new Error('SQUAD_SECRET_KEY and SQUAD_WEBHOOK_SECRET must be configured');
    }

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Create virtual account for user on first signup
   */
  async createVirtualAccount(
    userId: string,
    firstName: string,
    lastName: string,
    phone: string,
    email?: string,
  ): Promise<{ virtual_account_number: string; bank_code: string }> {
    try {
      if (!this.beneficiaryAccount) {
        throw new Error('SQUAD_BENEFICIARY_ACCOUNT is not configured');
      }

      const response = await this.client.post('/virtual-account', {
        customer_identifier: userId,
        first_name: firstName,
        last_name: lastName,
        mobile_num: phone,
        email: email || 'noemail@paydrop.ng',
        bvn: this.testBvn,
        dob: this.testDob,
        beneficiary_account: this.beneficiaryAccount,
        gender: '1',
        address: '22 Test Street, Lagos',
      });

      if (response.status !== 200 || !response.data?.data) {
        throw new Error('Failed to create virtual account');
      }

      return {
        virtual_account_number: response.data.data.virtual_account_number,
        bank_code: response.data.data.bank_code,
      };
    } catch (error) {
      const msg = getAxiosErrorMessage(error);
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error('Squad VA creation error:', { status, data });
      } else {
        console.error('Squad VA creation error:', error);
      }
      throw new BadRequestException('Failed to create virtual account: ' + msg);
    }
  }

  /**
   * Lookup account details before transfer
   */
  async lookupAccount(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ account_name: string; bank_code: string }> {
    try {
      const response = await this.client.post('/account/lookup', {
        bank_code: bankCode,
        account_number: accountNumber,
      });

      if (response.status !== 200 || !response.data?.data) {
        throw new Error('Account not found');
      }

      return {
        account_name: response.data.data.account_name,
        bank_code: response.data.data.bank_code,
      };
    } catch (error) {
      const msg = getAxiosErrorMessage(error);
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error('Squad account lookup error:', { status, data });
      } else {
        console.error('Squad account lookup error:', error);
      }
      throw new BadRequestException('Account lookup failed: ' + msg);
    }
  }

  /**
   * Initiate transfer to external bank (withdrawal)
   */
  async initiateTransfer(
    amount: number, // kobo
    bankCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string,
  ): Promise<{ transaction_ref: string; status: string }> {
    try {
      // Convert kobo to naira for Squad API
      const amountNaira = Math.floor(amount / 100);

      const response = await this.client.post('/transfer', {
        amount: amountNaira,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: accountName,
        narration: narration || 'PayDrop Transfer',
      });

      if (response.status !== 200 || !response.data?.data) {
        throw new Error('Transfer initiation failed');
      }

      return {
        transaction_ref: response.data.data.transaction_ref,
        status: response.data.data.status,
      };
    } catch (error) {
      const msg = getAxiosErrorMessage(error);
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error('Squad transfer error:', { status, data });
      } else {
        console.error('Squad transfer error:', error);
      }
      throw new BadRequestException('Transfer failed: ' + msg);
    }
  }

  /**
   * Simulate top-up in sandbox (triggers real webhook)
   */
  async simulateTopup(
    virtualAccountNumber: string,
    amount: number, // in NAIRA (NOT kobo)
  ): Promise<void> {
    try {
      const response = await this.client.post(
        '/virtual-account/simulate/payment',
        {
          virtual_account_number: virtualAccountNumber,
          amount: amount, // Keep as naira
        },
      );

      if (response.status !== 200) {
        throw new Error('Simulation failed');
      }
    } catch (error) {
      const msg = getAxiosErrorMessage(error);
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error('Squad simulate topup error:', { status, data });
      } else {
        console.error('Squad simulate topup error:', error);
      }
      throw new BadRequestException('Simulation failed: ' + msg);
    }
  }

  /**
   * Get missed webhook logs for recovery cron
   */
  async getMissedWebhooks(): Promise<any[]> {
    try {
      const response = await this.client.get('/virtual-account/webhook/logs');
      if (response.status !== 200 || !response.data?.data) {
        return [];
      }
      const data = response.data.data;
      if (Array.isArray(data)) {
        return data;
      }

      if (data && typeof data === 'object') {
        const candidates = [
          (data as any).logs,
          (data as any).items,
          (data as any).records,
          (data as any).data,
        ];
        for (const c of candidates) {
          if (Array.isArray(c)) {
            return c;
          }
        }
      }

      return [];
    } catch (error) {
      console.error('Squad get missed webhooks error:', error);
      return [];
    }
  }

  /**
   * Delete missed webhook log entry
   */
  async deleteMissedWebhookLog(transactionRef: string): Promise<void> {
    try {
      await this.client.delete(
        `/virtual-account/webhook/logs/${transactionRef}`,
      );
    } catch (error) {
      console.error('Squad delete missed webhook error:', error);
    }
  }

  /**
   * Validate Squad webhook signature
   */
  validateWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
  ): boolean {
    const crypto = require('crypto');
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const hash = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(body)
      .digest('hex');
    return hash === signature;
  }
}

function normalizeDobToMmDdYyyy(input: string): string {
  const trimmed = input.trim();

  const slash = /^\d{2}\/\d{2}\/\d{4}$/;
  if (slash.test(trimmed)) {
    const [a, b, c] = trimmed.split('/');
    const first = Number(a);
    const second = Number(b);
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      throw new Error('Invalid SQUAD_TEST_DOB');
    }

    if (first > 12 && second <= 12) {
      return `${b}/${a}/${c}`;
    }
    return trimmed;
  }

  const dash = /^\d{4}-\d{2}-\d{2}$/;
  if (dash.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split('-');
    return `${mm}/${dd}/${yyyy}`;
  }

  throw new Error('SQUAD_TEST_DOB must be mm/dd/yyyy, dd/mm/yyyy, or yyyy-mm-dd');
}

function getAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const apiMessage = (error.response?.data as any)?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim().length > 0) {
      return apiMessage;
    }
    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      return error.message;
    }
    return 'Request failed';
  }

  return error instanceof Error ? error.message : String(error);
}
