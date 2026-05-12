import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class SquadService {
  private client: AxiosInstance;
  private secretKey: string | undefined;
  private webhookSecret: string | undefined;
  private merchantId: string | undefined;
  private testBvn: string | undefined;
  private testDob: string | undefined;
  private beneficiaryAccount: string | undefined;
  private beneficiaryBankCode: string | undefined;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('SQUAD_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('SQUAD_WEBHOOK_SECRET');
    this.merchantId = this.configService.get<string>('SQUAD_MERCHANT_ID');
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
   * Squad validates BVN against first_name, last_name, dob, and phone when creating
   * individual virtual accounts — there is no separate documented “BVN-only” API.
   * Sandbox docs commonly show test BVN `22110011001` with matching identity fields.
   * Defaults come from SQUAD_TEST_BVN / SQUAD_TEST_DOB when signup omits explicit identity.
   */
  async createVirtualAccount(
    userId: string,
    firstName: string,
    lastName: string,
    phone: string,
    email?: string,
    identity?: { bvn: string; dob: string },
  ): Promise<{ virtual_account_number: string; bank_code: string }> {
    try {
      if (!this.beneficiaryAccount) {
        throw new Error('SQUAD_BENEFICIARY_ACCOUNT is not configured');
      }

      const bvn = identity?.bvn?.trim() || this.testBvn;
      const dob = identity?.dob
        ? normalizeDobToMmDdYyyy(identity.dob)
        : this.testDob;

      const response = await this.client.post('/virtual-account', {
        customer_identifier: userId,
        first_name: firstName,
        last_name: lastName,
        mobile_num: phone,
        email: email || 'noemail@paydrop.ng',
        bvn,
        dob,
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
   * NIP account lookup before payout (Squad Payout API).
   * Squad expects nip_code (6-char bank code) not bank_code.
   * @see https://docs.squadco.com/Transfer-API/transfer-apis
   */
  async lookupAccount(
    nipCode: string,
    accountNumber: string,
  ): Promise<{ account_name: string; nip_code: string }> {
    try {
      const response = await this.client.post('/payout/account/lookup', {
        nip_code: nipCode,
        account_number: accountNumber,
      });

      if (response.status !== 200 || !response.data?.data) {
        throw new Error('Account not found');
      }

      const d = response.data.data as Record<string, unknown>;
      return {
        account_name: String(d.account_name ?? ''),
        nip_code: String(d.nip_code ?? nipCode),
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
   * Payout from Squad ledger to a bank account (after lookup).
   * Amount is in kobo; API expects a string in kobo per Squad docs.
   * transaction_reference must be prefixed with your Squad merchant ID (SQUAD_MERCHANT_ID).
   */
  async initiateTransfer(
    amount: number, // kobo
    nipCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string,
  ): Promise<{ transaction_ref: string; status: string }> {
    try {
      if (!this.merchantId?.trim()) {
        throw new Error(
          'SQUAD_MERCHANT_ID is required for payout transfers (prefix for transaction_reference)',
        );
      }

      const transactionReference = `${this.merchantId.trim()}_pd_${randomUUID()}`;
      const remark = (narration || 'PayDrop Transfer').slice(0, 120);

      const response = await this.client.post('/payout/transfer', {
        transaction_reference: transactionReference,
        amount: String(Math.floor(amount)),
        nip_code: nipCode,
        account_number: accountNumber,
        account_name: accountName,
        currency_id: 'NGN',
        remark,
      });

      if (response.status !== 200 || !response.data?.data) {
        throw new Error('Transfer initiation failed');
      }

      const data = response.data.data as Record<string, unknown>;
      const ref =
        (typeof data.transaction_reference === 'string' && data.transaction_reference) ||
        (typeof data.transaction_ref === 'string' && data.transaction_ref) ||
        transactionReference;
      const status =
        (typeof data.status === 'string' && data.status) ||
        (typeof data.response_description === 'string' && data.response_description) ||
        'pending';

      return {
        transaction_ref: ref,
        status,
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
  ): Promise<string | null> {
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

      const data = (response.data && (response.data.data ?? response.data)) as any;
      const transactionRef =
        data?.transaction_ref ??
        data?.transaction_reference ??
        data?.transactionRef ??
        data?.reference ??
        data?.ref ??
        null;

      return typeof transactionRef === 'string' && transactionRef.trim().length > 0
        ? transactionRef
        : null;
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
