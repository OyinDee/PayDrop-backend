import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { mapSquadBankCodeToNip } from '../utils/squad-bank-code.util';

type SquadPayoutAttemptLog = {
  variant: 'bank_code' | 'nip_code';
  request_body: Record<string, unknown>;
  http_status?: number;
  response_body?: unknown;
  error_message?: string;
};

@Injectable()
export class SquadService {
  private readonly logger = new Logger(SquadService.name);
  private client: AxiosInstance;
  private secretKey: string | undefined;
  private webhookSecret: string | undefined;
  private merchantId: string | undefined;
  private isSandbox: boolean;
  private testBvn: string | undefined;
  private testDob: string | undefined;
  private beneficiaryAccount: string | undefined;
  private beneficiaryBankCode: string | undefined;
  private sandboxDefaultNipCode: string;

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

    this.isSandbox = baseURL.toLowerCase().includes('sandbox');

    const configuredSandboxNip = this.configService.get<string>(
      'SQUAD_SANDBOX_DEFAULT_NIP_CODE',
    );
    this.sandboxDefaultNipCode = (
      configuredSandboxNip || this.beneficiaryBankCode || '000013'
    ).trim();

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

  private resolveNipCode(inputNipCode: string): string {
    const nipCode = String(inputNipCode || '').trim();
    const isValidNip = /^\d{6}$/.test(nipCode);

    if (isValidNip) return nipCode;
    if (this.isSandbox && /^\d{6}$/.test(this.sandboxDefaultNipCode)) {
      return this.sandboxDefaultNipCode;
    }

    throw new BadRequestException(
      'Invalid nip_code; expected a 6-digit NIP bank code',
    );
  }

  private squadBaseUrl(): string {
    return String(this.client.defaults.baseURL || '');
  }

  private logSquadOutgoing(
    operation: string,
    path: string,
    context: Record<string, unknown>,
    requestBody: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'squad_request',
        operation,
        method: 'POST',
        base_url: this.squadBaseUrl(),
        path,
        context,
        request_body: requestBody,
      }),
    );
  }

  private logSquadFailure(
    operation: string,
    path: string,
    context: Record<string, unknown>,
    attempts: SquadPayoutAttemptLog[],
  ): void {
    const payload = JSON.stringify({
      event: 'squad_request_failed',
      operation,
      method: 'POST',
      base_url: this.squadBaseUrl(),
      path,
      context,
      attempts,
    });
    if (context.paydrop_internal_va === true) {
      this.logger.warn(payload);
    } else {
      this.logger.error(payload);
    }
  }

  private recordAxiosAttempt(
    variant: 'bank_code' | 'nip_code',
    requestBody: Record<string, unknown>,
    error: unknown,
  ): SquadPayoutAttemptLog {
    const entry: SquadPayoutAttemptLog = { variant, request_body: requestBody };
    if (axios.isAxiosError(error)) {
      entry.http_status = error.response?.status;
      entry.response_body = error.response?.data;
      entry.error_message = getAxiosErrorMessage(error);
    } else {
      entry.error_message =
        error instanceof Error ? error.message : String(error);
    }
    return entry;
  }

  private async postPayoutWithCodeFallback(
    path: string,
    resolvedCode: string,
    payloadWithoutCode: Record<string, unknown>,
    operation: string,
    requestContext: Record<string, unknown> = {},
  ): Promise<AxiosResponse<{ data?: Record<string, unknown> }>> {
    const bankCodePayload = {
      ...payloadWithoutCode,
      bank_code: resolvedCode,
    };
    const nipCodePayload = {
      ...payloadWithoutCode,
      nip_code: resolvedCode,
    };
    const attempts: SquadPayoutAttemptLog[] = [];

    this.logSquadOutgoing(operation, path, requestContext, bankCodePayload);

    try {
      return await this.postWithTransientRetry(path, bankCodePayload);
    } catch (error) {
      attempts.push(this.recordAxiosAttempt('bank_code', bankCodePayload, error));

      if (!axios.isAxiosError(error)) {
        this.logSquadFailure(operation, path, requestContext, attempts);
        throw error;
      }

      const msg = String(error.response?.data?.message || '').toLowerCase();
      const shouldRetryWithNip =
        (msg.includes('nip_code') && msg.includes('required')) ||
        (msg.includes('bank_code') &&
          (msg.includes('is not allowed') || msg.includes('not allowed')));

      if (!shouldRetryWithNip) {
        this.logSquadFailure(operation, path, requestContext, attempts);
        throw error;
      }

      this.logger.warn(
        JSON.stringify({
          event: 'squad_request_retry',
          operation,
          path,
          retry_variant: 'nip_code',
          request_body: nipCodePayload,
        }),
      );

      try {
        return await this.postWithTransientRetry(path, nipCodePayload);
      } catch (retryError) {
        attempts.push(this.recordAxiosAttempt('nip_code', nipCodePayload, retryError));
        this.logSquadFailure(operation, path, requestContext, attempts);
        throw retryError;
      }
    }
  }

  private isTransientSquadStatus(status?: number): boolean {
    return status != null && [500, 502, 503].includes(status);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Retry Squad 5xx / 424 on account lookup (sandbox is often flaky). */
  private async postWithTransientRetry(
    path: string,
    body: Record<string, unknown>,
    maxAttempts = 3,
  ): Promise<AxiosResponse<{ data?: Record<string, unknown> }>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.client.post(path, body);
      } catch (error) {
        lastError = error;
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        const canRetry =
          attempt < maxAttempts && this.isTransientSquadStatus(status);
        if (!canRetry) throw error;

        this.logger.warn(
          JSON.stringify({
            event: 'squad_transient_retry',
            path,
            attempt,
            max_attempts: maxAttempts,
            http_status: status,
            delay_ms: 800 * attempt,
          }),
        );
        await this.sleep(800 * attempt);
      }
    }
    throw lastError;
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
   * @see https://docs.squadco.com/Transfer-API/transfer-apis
   */
  async lookupAccount(
    bankCode: string,
    accountNumber: string,
    logContext: Record<string, unknown> = {},
  ): Promise<{ account_name: string; account_number: string }> {
    const primaryCode = this.resolveNipCode(bankCode);
    const storedRaw = String(logContext.squad_bank_code_stored ?? '').trim();
    const mappedStored = mapSquadBankCodeToNip(storedRaw);
    // Squad requires 6-digit NIP bank_code — never send short VA codes like "058".
    const bankCodesTried = [
      ...new Set(
        [primaryCode, mappedStored].filter(
          (c): c is string => typeof c === 'string' && /^\d{6}$/.test(c),
        ),
      ),
    ];

    const requestContext = {
      input_bank_code: bankCode,
      primary_nip_code: primaryCode,
      bank_codes_tried: bankCodesTried,
      account_number: accountNumber,
      is_sandbox: this.isSandbox,
      ...logContext,
    };

    const attempts: SquadPayoutAttemptLog[] = [];
    let lastError: unknown;

    for (const code of bankCodesTried) {
      const body = { account_number: accountNumber, bank_code: code };
      this.logSquadOutgoing('account_lookup', '/payout/account/lookup', {
        ...requestContext,
        bank_code_attempt: code,
      }, body);

      try {
        const response = await this.postWithTransientRetry(
          '/payout/account/lookup',
          body,
          2,
        );

        if (response.status !== 200 || !response.data?.data) {
          throw new Error('Account not found');
        }

        const d = response.data.data as Record<string, unknown>;
        return {
          account_name: String(d.account_name ?? ''),
          account_number: String(d.account_number ?? accountNumber),
        };
      } catch (error) {
        lastError = error;
        attempts.push(this.recordAxiosAttempt('bank_code', body, error));
      }
    }

    this.logSquadFailure(
      'account_lookup',
      '/payout/account/lookup',
      requestContext,
      attempts,
    );

    const msg = getAxiosErrorMessage(lastError);
    const httpStatus = axios.isAxiosError(lastError)
      ? lastError.response?.status
      : undefined;
    const saw424 = attempts.some((a) => a.http_status === 424);
    const saw500 = attempts.some((a) => a.http_status === 500);
    const paydropInternal = logContext.paydrop_internal_va === true;

    let hint: string | undefined;
    if (saw424 || httpStatus === 424) {
      hint =
        'Squad NIP lookup could not resolve this virtual account (424). PayDrop uses the registered profile name for P2P when NIP lookup is unavailable.';
    } else if (saw500 || httpStatus === 500) {
      hint =
        'Squad payout API returned 500. Retries were attempted; try again or check Squad sandbox status.';
    }

    throw new BadRequestException({
      message: 'Account lookup failed: ' + msg,
      squad_http_status: httpStatus,
      squad_message: msg,
      squad_lookup_eligible_for_paydrop_fallback:
        paydropInternal || saw424 || saw500 || httpStatus === 424 || httpStatus === 500,
      ...(hint ? { hint } : {}),
      request: {
        account_number: accountNumber,
        input_bank_code: bankCode,
        bank_codes_tried: bankCodesTried,
        squad_bank_code_stored: storedRaw || null,
      },
    });
  }

  /**
   * Payout from Squad ledger to a bank account (after lookup).
   * Amount is in kobo; API expects a string in kobo per Squad docs.
   * transaction_reference must be prefixed with your Squad merchant ID (SQUAD_MERCHANT_ID).
   */
  async initiateTransfer(
    amount: number, // kobo
    bankCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string,
  ): Promise<{
    transaction_ref: string;
    status: string;
    nip_transaction_reference?: string;
  }> {
    try {
      if (!this.merchantId?.trim()) {
        throw new Error(
          'SQUAD_MERCHANT_ID is required for payout transfers (prefix for transaction_reference)',
        );
      }

      const transactionReference = `${this.merchantId.trim()}_pd_${randomUUID()}`;
      const remark = (narration || 'PayDrop Transfer').slice(0, 120);
      const resolvedCode = this.resolveNipCode(bankCode);

      const response = await this.postPayoutWithCodeFallback(
        '/payout/transfer',
        resolvedCode,
        {
          transaction_reference: transactionReference,
          amount: String(Math.floor(amount)),
          account_number: accountNumber,
          account_name: accountName,
          currency_id: 'NGN',
          remark,
        },
        'transfer',
        {
          input_bank_code: bankCode,
          resolved_nip_code: resolvedCode,
          account_number: accountNumber,
          amount_kobo: Math.floor(amount),
        },
      );

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
      const nipRef =
        typeof data.nip_transaction_reference === 'string'
          ? data.nip_transaction_reference
          : undefined;

      return {
        transaction_ref: ref,
        status,
        nip_transaction_reference: nipRef,
      };
    } catch (error) {
      const msg = getAxiosErrorMessage(error);
      throw new BadRequestException('Transfer failed: ' + msg);
    }
  }

  /**
   * Re-query payout transfer status (Squad Payout API).
   * @see https://docs.squadco.com/Transfer-API/transfer-apis
   */
  async requeryTransfer(transactionReference: string): Promise<{
    transaction_reference: string;
    status: string;
    nip_transaction_reference?: string;
    raw: Record<string, unknown>;
  }> {
    try {
      const ref = transactionReference.trim();
      if (!ref) {
        throw new BadRequestException('transaction_reference is required');
      }

      const response = await this.client.post('/payout/requery', {
        transaction_reference: ref,
      });

      if (response.status !== 200) {
        throw new Error('Transfer requery failed');
      }

      const data = (response.data?.data ?? response.data) as Record<string, unknown>;
      const status =
        (typeof data?.status === 'string' && data.status) ||
        (typeof data?.response_description === 'string' && data.response_description) ||
        'unknown';

      return {
        transaction_reference:
          (typeof data?.transaction_reference === 'string' && data.transaction_reference) ||
          ref,
        status,
        nip_transaction_reference:
          typeof data?.nip_transaction_reference === 'string'
            ? data.nip_transaction_reference
            : undefined,
        raw: data && typeof data === 'object' ? data : {},
      };
    } catch (error) {
      const msg = getAxiosErrorMessage(error);
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error('Squad transfer requery error:', { status, data });
      } else {
        console.error('Squad transfer requery error:', error);
      }
      throw new BadRequestException('Transfer requery failed: ' + msg);
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
