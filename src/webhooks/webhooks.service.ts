import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { SquadService } from '../common/services/squad.service';
import { WalletService } from '../wallet/wallet.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly squad: SquadService,
    private readonly wallet: WalletService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async handleSquadWebhook(rawBody: Buffer | undefined, body: any, signature: string) {
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const raw = rawBody || Buffer.from(JSON.stringify(body));
    const ok = this.squad.validateWebhookSignature(raw, signature);
    if (!ok) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const squadRef =
      body?.transaction_ref ||
      body?.transactionRef ||
      body?.reference ||
      body?.data?.transaction_ref ||
      body?.data?.reference;

    if (!squadRef) {
      // Still return 200 to stop retries; log for investigation.
      return { success: true };
    }

    // Duplicate guard: squad_ref:{ref} TTL 24hr
    const dedupeKey = `squad_ref:${squadRef}`;
    const duplicate = await this.redis.exists(dedupeKey);
    if (duplicate) {
      return { success: true };
    }

    // Best-effort event parsing (Squad payload formats vary between products)
    const event = body?.event_type || body?.type || body?.event;
    const status = body?.status || body?.data?.status;

    // Top-up webhook: virtual account credit
    const virtualAccountNumber =
      body?.virtual_account_number ||
      body?.data?.virtual_account_number ||
      body?.virtualAccountNumber;

    const amountNaira =
      body?.amount ||
      body?.data?.amount ||
      body?.amount_paid ||
      body?.data?.amount_paid;

    // If payload includes a virtual account, treat as TOP_UP credit
    if (virtualAccountNumber && typeof amountNaira === 'number') {
      const amountKobo = Math.round(amountNaira * 100);
      await this.wallet.processWebhookPayment(
        String(virtualAccountNumber),
        amountKobo,
        String(squadRef),
      );
      await this.redis.set(dedupeKey, true, 86400);
      return { success: true };
    }

    // Otherwise treat as transfer settlement (TRANSFER or WITHDRAWAL)
    // We update by squad_ref match in DB.
    const tx = await this.prisma.transaction.findFirst({
      where: { squad_ref: String(squadRef) },
    });

    if (!tx) {
      // Contract says queue & retry; for now: log and return 200.
      await this.activityLog.log('SYSTEM', 'TRANSFER_FAILED', {
        reason: 'Orphaned webhook (tx not found)',
        squad_ref: squadRef,
        event,
      });
      return { success: true };
    }

    const isSuccess =
      status === 'success' ||
      status === 'successful' ||
      event === 'transfer.completed' ||
      event === 'payment_successful';

    const isFailed =
      status === 'failed' ||
      event === 'transfer.failed' ||
      event === 'payment_failed';

    if (tx.type === 'WITHDRAWAL') {
      await this.wallet.processWithdrawalWebhook(String(squadRef), isSuccess ? 'success' : 'failed');
      await this.redis.set(dedupeKey, true, 86400);
      return { success: true };
    }

    if (tx.type === 'TRANSFER') {
      if (isSuccess) {
        await this.prisma.$transaction(async (p: any) => {
          await p.transaction.update({
            where: { id: tx.id },
            data: { status: 'COMPLETED' },
          });
          if (tx.sender_id) {
            await p.wallet.update({
              where: { user_id: tx.sender_id },
              data: { balance: { decrement: tx.amount } },
            });
          }
          if (tx.recipient_id) {
            await p.wallet.update({
              where: { user_id: tx.recipient_id },
              data: { balance: { increment: tx.amount } },
            });
          }
        });
        await this.activityLog.log(tx.sender_id || '', 'TRANSFER_COMPLETED', {
          transaction_id: tx.id,
          squad_ref: squadRef,
          amount: Number(tx.amount),
        });
      } else if (isFailed) {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { status: 'FAILED' },
        });
        await this.activityLog.log(tx.sender_id || '', 'TRANSFER_FAILED', {
          transaction_id: tx.id,
          squad_ref: squadRef,
        });
      }
      await this.redis.set(dedupeKey, true, 86400);
      return { success: true };
    }

    await this.redis.set(dedupeKey, true, 86400);
    return { success: true };
  }

  @Cron('0 */30 * * * *')
  async recoverMissedWebhooks(): Promise<void> {
    const missed = await this.squad.getMissedWebhooks();
    for (const tx of missed) {
      const ref =
        tx?.transaction_ref || tx?.transactionRef || tx?.reference || tx?.data?.transaction_ref;
      if (!ref) {
        continue;
      }

      const already = await this.prisma.transaction.findFirst({
        where: { squad_ref: String(ref) },
      });

      if (!already) {
        // Best-effort processing with no signature context (missed log source is Squad API).
        const virtualAccountNumber = tx?.virtual_account_number || tx?.data?.virtual_account_number;
        const amountNaira = tx?.amount || tx?.data?.amount;
        if (virtualAccountNumber && typeof amountNaira === 'number') {
          await this.wallet.processWebhookPayment(
            String(virtualAccountNumber),
            Math.round(amountNaira * 100),
            String(ref),
          );
        }
      }

      await this.squad.deleteMissedWebhookLog(String(ref));
    }
  }
}
