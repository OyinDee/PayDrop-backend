import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { FraudService } from '../common/services/fraud.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class TransactionsService {
  private readonly MIN_TRANSFER = 100n; // NGN 100
  private readonly CONFIRM_TTL_SECONDS = 900; // 15min

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly fraud: FraudService,
    private readonly squad: SquadService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async transfer(
    senderId: string,
    recipientId: string,
    amount: number,
    idempotencyKey: string,
    note?: string,
    nipCode?: string,
  ) {
    if (recipientId === senderId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    const amountKobo = BigInt(amount);
    if (amountKobo < this.MIN_TRANSFER) {
      throw new BadRequestException('Minimum transfer is 100 naira');
    }

    // Pre-check 1 — Idempotency (return original response; do not reprocess)
    const existing = await this.prisma.transaction.findUnique({
      where: { idempotency_key: idempotencyKey },
    });
    if (existing) {
      return {
        transaction_id: existing.id,
        status: existing.status,
        fraud_score: existing.fraud_score,
        verdict: existing.verdict,
        squad_ref: existing.squad_ref,
        confirm_token: existing.confirm_token,
      };
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      include: { wallet: true },
    });
    if (!sender?.wallet) throw new NotFoundException('Sender wallet not found');

    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    // Pre-check 2 — Balance (and pessimistic lock inside the transaction)
    // Pre-check 3 — Fraud score (fail open)
    const fraud = await this.fraud.scoreTransaction({
      sender_id: senderId,
      recipient_id: recipientId,
      amount: Number(amountKobo),
    });

    await this.activityLog.log(senderId, 'TRANSFER_FRAUD_SCORED', {
      score: fraud.score,
      verdict: fraud.verdict,
      reason: fraud.reason,
    });

    if (fraud.verdict === 'BLOCK') {
      await this.prisma.transaction.create({
        data: {
          sender_id: senderId,
          recipient_id: recipientId,
          amount: amountKobo,
          type: 'TRANSFER',
          status: 'BLOCKED',
          idempotency_key: idempotencyKey,
          fraud_score: fraud.score,
          verdict: 'BLOCK',
          fraud_reason: fraud.reason,
          note: note || null,
        },
      });
      await this.activityLog.log(senderId, 'TRANSFER_BLOCKED', {
        recipient_id: recipientId,
        amount: Number(amountKobo),
        reason: fraud.reason,
        fraud_score: fraud.score,
      });
      throw new UnprocessableEntityException({
        error: fraud.reason,
        fraud_score: fraud.score,
        verdict: 'BLOCK',
      });
    }

    if (fraud.verdict === 'FLAG') {
      const tx = await this.prisma.transaction.create({
        data: {
          sender_id: senderId,
          recipient_id: recipientId,
          amount: amountKobo,
          type: 'TRANSFER',
          status: 'PENDING_REVIEW',
          idempotency_key: idempotencyKey,
          fraud_score: fraud.score,
          verdict: 'FLAG',
          fraud_reason: fraud.reason,
          note: note || null,
        },
      });

      const confirmToken = uuidv4();
      const recipientNipCode = (nipCode || recipient.squad_bank_code || '').trim();
      await this.redis.set(
        `confirm:${confirmToken}`,
        {
          transaction_id: tx.id,
          sender_id: senderId,
          recipient_id: recipientId,
          amount: Number(amountKobo),
          nip_code: recipientNipCode,
        },
        this.CONFIRM_TTL_SECONDS,
      );

      await this.prisma.transaction.update({
        where: { id: tx.id },
        data: { confirm_token: confirmToken },
      });

      await this.activityLog.log(senderId, 'TRANSFER_FLAGGED', {
        transaction_id: tx.id,
        fraud_score: fraud.score,
        reason: fraud.reason,
      });

      return {
        transaction_id: tx.id,
        status: 'PENDING_REVIEW',
        fraud_score: fraud.score,
        verdict: 'FLAG',
        reason: fraud.reason,
        confirm_token: confirmToken,
      };
    }

    // ALLOW path: lock wallet row, re-check balance, call Squad, create PENDING tx.
    const created = (await this.prisma.$transaction(async (tx: any) => {
      // Pessimistic lock to prevent double spend.
      await tx.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${senderId} FOR UPDATE`;

      const lockedWallet = await tx.wallet.findUnique({
        where: { user_id: senderId },
      });
      if (!lockedWallet || lockedWallet.balance < amountKobo) {
        throw new BadRequestException('Insufficient funds');
      }

      // Verify recipient has Squad details
      if (!recipient.squad_virtual_account) {
        throw new BadRequestException('Recipient cannot receive transfers yet');
      }

      const recipientNipCode = (nipCode || recipient.squad_bank_code || '').trim();

      // Optional: verify recipient name (contract says account lookup)
      // We do a best-effort lookup; if it fails, we still stop (safer).
      const lookup = await this.squad.lookupAccount(
        recipientNipCode,  // NIP code (6 chars)
        recipient.squad_virtual_account,
      );
      const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
      if (
        lookup.account_name &&
        lookup.account_name.toLowerCase() !== recipientName.toLowerCase()
      ) {
        throw new BadRequestException('Recipient account name mismatch');
      }

      const squadTransfer = await this.squad.initiateTransfer(
        Number(amountKobo),
        recipientNipCode,  // NIP code (6 chars)
        recipient.squad_virtual_account,
        lookup.account_name || recipientName,
        'PayDrop P2P Transfer',
      );

      const txRow = await tx.transaction.create({
        data: {
          sender_id: senderId,
          recipient_id: recipientId,
          amount: amountKobo,
          type: 'TRANSFER',
          status: 'PENDING',
          idempotency_key: idempotencyKey,
          fraud_score: fraud.score,
          verdict: 'ALLOW',
          fraud_reason: fraud.reason,
          squad_ref: squadTransfer.transaction_ref,
          note: note || null,
        },
      });

      return { txRow, squadRef: squadTransfer.transaction_ref };
    })) as { txRow: any; squadRef: string };

    await this.activityLog.log(senderId, 'TRANSFER_INITIATED', {
      transaction_id: created.txRow.id,
      recipient_id: recipientId,
      amount: Number(amountKobo),
      squad_ref: created.squadRef,
    });

    return {
      transaction_id: created.txRow.id,
      status: 'PENDING',
      fraud_score: fraud.score,
      verdict: 'ALLOW',
      squad_ref: created.squadRef,
    };
  }

  async confirmTransfer(senderId: string, transactionId: string, confirmToken: string) {
    const payload = await this.redis.get<any>(`confirm:${confirmToken}`);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired confirm token');
    }
    if (payload.transaction_id !== transactionId || payload.sender_id !== senderId) {
      throw new UnauthorizedException('Confirm token mismatch');
    }

    await this.redis.del(`confirm:${confirmToken}`);

    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'PENDING_REVIEW') {
      return {
        transaction_id: tx.id,
        status: tx.status,
        fraud_score: tx.fraud_score,
        verdict: tx.verdict,
        squad_ref: tx.squad_ref,
      };
    }

    // Re-run ALLOW path initiation (same logic as transfer allow, but use existing tx row + idempotency_key)
    const recipient = await this.prisma.user.findUnique({ where: { id: tx.recipient_id || '' } });
    if (!recipient) throw new NotFoundException('Recipient not found');
    if (!recipient.squad_virtual_account) {
      throw new BadRequestException('Recipient cannot receive transfers yet');
    }

    const recipientNipCode = ((payload as any)?.nip_code || recipient.squad_bank_code || '').trim();

    const initiated = (await this.prisma.$transaction(async (p: any) => {
      await p.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${senderId} FOR UPDATE`;
      const lockedWallet = await p.wallet.findUnique({ where: { user_id: senderId } });
      if (!lockedWallet || lockedWallet.balance < tx.amount) {
        throw new BadRequestException('Insufficient funds');
      }

      const lookup = await this.squad.lookupAccount(
        recipientNipCode,  // NIP code (6 chars)
        recipient.squad_virtual_account,
      );
      const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
      if (
        lookup.account_name &&
        lookup.account_name.toLowerCase() !== recipientName.toLowerCase()
      ) {
        throw new BadRequestException('Recipient account name mismatch');
      }

      const squadTransfer = await this.squad.initiateTransfer(
        Number(tx.amount),
        recipientNipCode,  // NIP code (6 chars)
        recipient.squad_virtual_account,
        lookup.account_name || recipientName,
        'PayDrop P2P Transfer',
      );

      const updated = await p.transaction.update({
        where: { id: tx.id },
        data: {
          status: 'PENDING',
          squad_ref: squadTransfer.transaction_ref,
        },
      });

      return { updated, squadRef: squadTransfer.transaction_ref };
    })) as { updated: any; squadRef: string };

    await this.activityLog.log(senderId, 'TRANSFER_FLAG_CONFIRMED', {
      transaction_id: tx.id,
      squad_ref: initiated.squadRef,
    });

    return {
      transaction_id: initiated.updated.id,
      status: initiated.updated.status,
      fraud_score: initiated.updated.fraud_score,
      verdict: initiated.updated.verdict,
      squad_ref: initiated.squadRef,
    };
  }

  async getTransactions(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const transactions = await this.prisma.transaction.findMany({
      where: {
        OR: [{ sender_id: userId }, { recipient_id: userId }],
      },
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
    });

    const total = await this.prisma.transaction.count({
      where: {
        OR: [{ sender_id: userId }, { recipient_id: userId }],
      },
    });

    return {
      transactions: transactions.map((tx: any) => ({
        id: tx.id,
        sender_id: tx.sender_id,
        recipient_id: tx.recipient_id,
        amount: tx.amount,
        status: tx.status,
        note: tx.note,
        squad_ref: tx.squad_ref,
        fraud_score: tx.fraud_score,
        fraud_verdict: tx.verdict,
        createdAt: tx.created_at,
        updatedAt: tx.updated_at,
      })),
      total,
      page,
      limit,
    };
  }

  async getTransaction(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return {
      id: transaction.id,
      sender_id: transaction.sender_id,
      recipient_id: transaction.recipient_id,
      amount: transaction.amount,
      status: transaction.status,
      note: transaction.note,
      squad_ref: transaction.squad_ref,
      fraud_score: transaction.fraud_score,
      fraud_verdict: transaction.verdict,
      createdAt: transaction.created_at,
      updatedAt: transaction.updated_at,
    };
  }

  async getFraudDetail(transactionId: string) {
    const fraudEvent = await this.prisma.fraudEvent.findFirst({
      where: { transaction_id: transactionId },
    });

    if (!fraudEvent) {
      throw new NotFoundException('Fraud event not found');
    }

    return {
      score: fraudEvent.score,
      verdict: fraudEvent.verdict,
      reason: fraudEvent.reason,
      features: fraudEvent.features,
    };
  }
}
