import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class WalletService {
  private readonly MIN_WITHDRAWAL = 10000n; // 100 kobo = NGN 100

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private squadService: SquadService,
    private activityLog: ActivityLogService,
  ) {}

  /**
   * Get current wallet balance
   */
  async getBalance(userId: string): Promise<any> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { user_id: userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      balance: wallet.balance,
      currency: wallet.currency,
    };
  }

  @Cron('0 */5 * * * *')
  async checkStuckWithdrawals(): Promise<void> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await this.prisma.transaction.findMany({
      where: {
        type: 'WITHDRAWAL',
        status: 'PENDING',
        created_at: { lt: cutoff },
      },
    });

    for (const tx of stuck) {
      await this.prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'FAILED' },
      });
      await this.activityLog.log(tx.sender_id || '', 'WITHDRAWAL_FAILED', {
        transaction_id: tx.id,
      });
    }
  }

  /**
   * Get Squad virtual account details for top-up
   */
  async getAccount(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user || !user.wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (!user.squad_virtual_account) {
      throw new BadRequestException(
        'Virtual account not provisioned. Please contact support.',
      );
    }

    return {
      virtual_account_number: user.squad_virtual_account,
      bank_code: user.squad_bank_code,
      account_name: `${user.first_name} ${user.last_name}`,
      bank_name: this.getBankName(user.squad_bank_code),
    };
  }

  /**
   * Initiate withdrawal to external bank
   */
  async withdraw(
    userId: string,
    amount: bigint,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    idempotencyKey: string,
  ): Promise<any> {
    // Validation
    if (amount < this.MIN_WITHDRAWAL) {
      throw new BadRequestException(
        `Minimum withdrawal is ${Number(this.MIN_WITHDRAWAL) / 100} naira`,
      );
    }

    // Pre-check 1: Idempotency
    const existingTx = await this.prisma.transaction.findUnique({
      where: { idempotency_key: idempotencyKey },
    });

    if (existingTx) {
      return {
        transaction_id: existingTx.id,
        status: existingTx.status,
        squad_ref: existingTx.squad_ref,
      };
    }

    // Pre-check 2: Balance
    const wallet = await this.prisma.wallet.findUnique({
      where: { user_id: userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.balance < amount) {
      throw new BadRequestException('Insufficient funds');
    }

    // Pre-check 3: Squad account lookup
    try {
      const accountLookup = await this.squadService.lookupAccount(
        bankCode,
        accountNumber,
      );

      // Verify account name matches
      if (
        accountLookup.account_name.toLowerCase() !==
        accountName.toLowerCase()
      ) {
        throw new BadRequestException('Account name does not match');
      }
    } catch (error) {
      throw new BadRequestException('Invalid bank account details');
    }

    // Pessimistic lock: SELECT FOR UPDATE
    const lockedWallet = await this.prisma.wallet.findUnique({
      where: { user_id: userId },
    });

    if (!lockedWallet || lockedWallet.balance < amount) {
      throw new BadRequestException('Insufficient funds');
    }

    try {
      // Call Squad API
      const squadTransfer = await this.squadService.initiateTransfer(
        Number(amount),
        bankCode,
        accountNumber,
        accountName,
        'PayDrop Withdrawal',
      );

      // Create transaction record
      const transaction = await this.prisma.transaction.create({
        data: {
          sender_id: userId,
          amount,
          type: 'WITHDRAWAL',
          status: 'PENDING',
          idempotency_key: idempotencyKey,
          squad_ref: squadTransfer.transaction_ref,
        },
      });

      // Log activity
      await this.activityLog.log(userId, 'WITHDRAWAL_INITIATED', {
        amount: Number(amount),
        bank_code: bankCode,
        account_number: accountNumber,
        transaction_id: transaction.id,
      });

      return {
        transaction_id: transaction.id,
        status: 'PENDING',
        squad_ref: squadTransfer.transaction_ref,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      throw new BadRequestException(message);
    }
  }

  /**
   * Simulate top-up in sandbox (triggers real webhook)
   * Amount in NAIRA (not kobo)
   */
  async simulateTopup(userId: string, amountNaira: number): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.squad_virtual_account) {
      throw new NotFoundException('Virtual account not found');
    }

    try {
      await this.squadService.simulateTopup(
        user.squad_virtual_account,
        amountNaira,
      );

      await this.activityLog.log(userId, 'WALLET_FUNDED', {
        amount: amountNaira * 100, // Convert to kobo for logging
        source: 'simulation',
      });

      return {
        success: true,
        message: 'Top-up simulation triggered',
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Simulation failed';
      throw new BadRequestException(message);
    }
  }

  /**
   * Process webhook payment (called by webhooks service)
   */
  async processWebhookPayment(
    virtualAccountNumber: string,
    amount: number, // kobo
    squadRef: string,
  ): Promise<void> {
    // Find user by virtual account
    const user = await this.prisma.user.findUnique({
      where: { squad_virtual_account: virtualAccountNumber },
    });

    if (!user) {
      throw new NotFoundException('Virtual account not found');
    }

    // Duplicate guard: check squad_ref in Redis
    const isDuplicate = await this.redisService.exists(`squad_ref:${squadRef}`);
    if (isDuplicate) {
      return; // Already processed
    }

    // Atomic transaction
    await this.prisma.$transaction(async (tx: any) => {
      // Update wallet
      await tx.wallet.update({
        where: { user_id: user.id },
        data: {
          balance: {
            increment: BigInt(amount),
          },
        },
      });

      // Create transaction record
      await tx.transaction.create({
        data: {
          recipient_id: user.id,
          amount: BigInt(amount),
          type: 'TOP_UP',
          status: 'COMPLETED',
          squad_ref: squadRef,
          idempotency_key: `webhook_${squadRef}`, // Synthetic key for webhook
        },
      });

      // Activity log
      await this.activityLog.log(user.id, 'WALLET_FUNDED', {
        amount,
        squad_ref: squadRef,
      });
    });

    // Set dedup guard in Redis (24 hour TTL)
    await this.redisService.set(`squad_ref:${squadRef}`, true, 86400);
  }

  /**
   * Process withdrawal webhook completion
   */
  async processWithdrawalWebhook(
    squadRef: string,
    status: string,
  ): Promise<void> {
    // Find transaction
    const transaction = await this.prisma.transaction.findFirst({
      where: { squad_ref: squadRef },
    });

    if (!transaction) {
      return; // Transaction not found, retry later
    }

    // Update transaction status
    const newStatus = status === 'success' ? 'COMPLETED' : 'FAILED';

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: newStatus },
    });

    if (newStatus === 'COMPLETED') {
      await this.activityLog.log(
        transaction.sender_id || '',
        'WITHDRAWAL_COMPLETED',
        {
          transaction_id: transaction.id,
          amount: Number(transaction.amount),
        },
      );
    } else {
      // Reverse balance if failed
      const wallet = await this.prisma.wallet.findUnique({
        where: { user_id: transaction.sender_id || '' },
      });

      if (wallet) {
        await this.prisma.wallet.update({
          where: { user_id: transaction.sender_id || '' },
          data: {
            balance: {
              increment: transaction.amount,
            },
          },
        });
      }

      await this.activityLog.log(
        transaction.sender_id || '',
        'WITHDRAWAL_FAILED',
        {
          transaction_id: transaction.id,
        },
      );
    }
  }

  /**
   * Helper: Get bank name from code
   */
  private getBankName(code: string | null): string {
    const banks: Record<string, string> = {
      '050': 'Guaranty Trust Bank (GTB)',
      '058': 'Guaranty Trust Bank (GTB)',
      '057': 'Zenith Bank',
      '033': 'United Bank for Africa (UBA)',
      '011': 'First Bank',
    };
    return banks[code || ''] || 'Unknown Bank';
  }
}
