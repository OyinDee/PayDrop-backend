import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { SquadService } from '../common/services/squad.service';
import { WalletService } from '../wallet/wallet.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly squad: SquadService,
    private readonly wallet: WalletService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async handleSquadWebhook(rawBody: Buffer | undefined, body: any, signature: string) {
    if (!signature) {
      this.logger.error('Missing webhook signature');
      throw new UnauthorizedException('Missing webhook signature');
    }

    const raw = rawBody || Buffer.from(JSON.stringify(body));
    const ok = this.squad.validateWebhookSignature(raw, signature);
    if (!ok) {
      this.logger.error(
        JSON.stringify({
          event: 'invalid_webhook_signature',
          body_keys: Object.keys(body || {}),
        }),
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Extract squadRef from various possible locations in payload
    const squadRef =
      body?.transaction_ref ||
      body?.transaction_reference ||
      body?.transactionRef ||
      body?.reference ||
      body?.data?.transaction_ref ||
      body?.data?.transaction_reference ||
      body?.data?.reference ||
      body?.data?.squad_ref ||
      body?.squad_ref;

    if (!squadRef) {
      this.logger.warn(
        JSON.stringify({
          event: 'webhook_no_squad_ref',
          payload_keys: Object.keys(body || {}),
        }),
      );
      // Still return 200 to stop retries
      return { success: true };
    }

    // Duplicate guard: squad_ref:{ref} TTL 24hr
    const dedupeKey = `squad_ref:${squadRef}`;
    const duplicate = await this.redis.exists(dedupeKey);
    if (duplicate) {
      this.logger.log(`Duplicate webhook detected: ${squadRef}, skipping`);
      return { success: true };
    }

    // Log webhook receipt for debugging
    this.logger.log(
      JSON.stringify({
        event: 'webhook_received',
        squad_ref: squadRef,
        event_type: body?.event_type || body?.type || body?.event,
        status: body?.status || body?.data?.status,
        timestamp: new Date().toISOString(),
      }),
    );

    // Parse event details
    const event = body?.event_type || body?.type || body?.event;
    const status = body?.status || body?.data?.status;

    // Top-up webhook: virtual account credit (inbound payment)
    const virtualAccountNumber =
      body?.virtual_account_number ||
      body?.data?.virtual_account_number ||
      body?.virtualAccountNumber;

    const amountNaira =
      body?.amount ||
      body?.data?.amount ||
      body?.amount_paid ||
      body?.data?.amount_paid;

    // ==================== TOP-UP FLOW ====================
    // If payload includes a virtual account, treat as TOP_UP credit
    if (virtualAccountNumber && typeof amountNaira === 'number') {
      this.logger.log(
        JSON.stringify({
          event: 'webhook_topup_detected',
          squad_ref: squadRef,
          virtual_account: virtualAccountNumber,
          amount_naira: amountNaira,
        }),
      );

      const amountKobo = Math.round(amountNaira * 100);
      try {
        await this.wallet.processWebhookPayment(
          String(virtualAccountNumber),
          amountKobo,
          String(squadRef),
        );
        await this.redis.set(dedupeKey, true, 86400);
        
        this.logger.log(
          JSON.stringify({
            event: 'topup_credit_applied',
            squad_ref: squadRef,
            amount_kobo: amountKobo,
          }),
        );
        
        return { success: true };
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          JSON.stringify({
            event: 'topup_credit_failed',
            squad_ref: squadRef,
            error: err.message,
            stack: err.stack,
          }),
        );
        throw error;
      }
    }

    // ==================== TRANSFER/WITHDRAWAL FLOW ====================
    // Otherwise treat as transfer settlement (TRANSFER or WITHDRAWAL)
    // We update by squad_ref match in DB.
    const tx = await this.prisma.transaction.findFirst({
      where: { squad_ref: String(squadRef) },
    });

    if (!tx) {
      this.logger.warn(
        JSON.stringify({
          event: 'webhook_transaction_not_found',
          squad_ref: squadRef,
          event_type: event,
        }),
      );
      // Return 200 to prevent retries; log for manual investigation
      await this.activityLog.log('SYSTEM', 'WEBHOOK_ORPHANED', {
        reason: 'Transaction not found in database',
        squad_ref: squadRef,
        event_type: event,
      });
      return { success: true };
    }

    // Classify status
    const isSuccess =
      status === 'success' ||
      status === 'successful' ||
      status === 'COMPLETED' ||
      event === 'transfer.completed' ||
      event === 'payment_successful' ||
      event === 'payout.transfer.completed';

    const isFailed =
      status === 'failed' ||
      status === 'FAILED' ||
      event === 'transfer.failed' ||
      event === 'payment_failed' ||
      event === 'payout.transfer.failed';

    this.logger.log(
      JSON.stringify({
        event: 'webhook_classified',
        transaction_id: tx.id,
        squad_ref: squadRef,
        transaction_type: tx.type,
        squad_status: status,
        classified_as: isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING',
      }),
    );

    // ==================== WITHDRAWAL SETTLEMENT ====================
    if (tx.type === 'WITHDRAWAL') {
      try {
        await this.wallet.processWithdrawalWebhook(
          String(squadRef),
          isSuccess ? 'success' : isFailed ? 'failed' : 'pending',
        );
        await this.redis.set(dedupeKey, true, 86400);

        this.logger.log(
          JSON.stringify({
            event: 'withdrawal_settled',
            transaction_id: tx.id,
            squad_ref: squadRef,
            status: isSuccess ? 'success' : 'failed',
          }),
        );

        return { success: true };
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          JSON.stringify({
            event: 'withdrawal_settlement_failed',
            transaction_id: tx.id,
            squad_ref: squadRef,
            error: err.message,
          }),
        );
        throw error;
      }
    }

    // ==================== P2P TRANSFER SETTLEMENT ====================
    if (tx.type === 'TRANSFER') {
      let shouldDedupe = false;

      if (isSuccess) {
        this.logger.log(
          JSON.stringify({
            event: 'transfer_success_webhook',
            transaction_id: tx.id,
            sender_id: tx.sender_id,
            recipient_id: tx.recipient_id,
            amount: Number(tx.amount),
            squad_ref: squadRef,
          }),
        );

        try {
          // This completes the transfer and credits the recipient
          const applied = await this.wallet.completePendingP2pTransfer(tx.id);
          
          if (applied) {
            shouldDedupe = true;

            // Log activity for both users
            await this.activityLog.log(tx.sender_id, 'TRANSFER_COMPLETED', {
              transaction_id: tx.id,
              recipient_id: tx.recipient_id,
              amount: Number(tx.amount),
              squad_ref: squadRef,
              via: 'webhook',
            });

            await this.activityLog.log(tx.recipient_id, 'TRANSFER_RECEIVED', {
              transaction_id: tx.id,
              sender_id: tx.sender_id,
              amount: Number(tx.amount),
              squad_ref: squadRef,
              via: 'webhook',
            });

            this.logger.log(
              JSON.stringify({
                event: 'transfer_credited',
                transaction_id: tx.id,
                recipient_id: tx.recipient_id,
                amount_kobo: Number(tx.amount),
                squad_ref: squadRef,
              }),
            );
          } else {
            // Check if already completed
            const cur = await this.prisma.transaction.findUnique({
              where: { id: tx.id },
              select: { status: true },
            });

            if (cur?.status === 'COMPLETED') {
              this.logger.log(
                JSON.stringify({
                  event: 'transfer_already_completed',
                  transaction_id: tx.id,
                  squad_ref: squadRef,
                  reason: 'Previous webhook or request completed it',
                }),
              );
              shouldDedupe = true;
            } else {
              this.logger.warn(
                JSON.stringify({
                  event: 'transfer_credit_failed',
                  transaction_id: tx.id,
                  squad_ref: squadRef,
                  current_status: cur?.status,
                  reason: 'completePendingP2pTransfer returned false',
                }),
              );
            }
          }
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            JSON.stringify({
              event: 'transfer_completion_error',
              transaction_id: tx.id,
              squad_ref: squadRef,
              error: err.message,
              stack: err.stack,
            }),
          );
          throw error;
        }
      } else if (isFailed) {
        this.logger.log(
          JSON.stringify({
            event: 'transfer_failed_webhook',
            transaction_id: tx.id,
            squad_ref: squadRef,
          }),
        );

        try {
          const applied = await this.wallet.failPendingP2pTransfer(tx.id);

          if (applied) {
            shouldDedupe = true;

            // Log activity for sender
            await this.activityLog.log(tx.sender_id, 'TRANSFER_FAILED', {
              transaction_id: tx.id,
              recipient_id: tx.recipient_id,
              amount: Number(tx.amount),
              squad_ref: squadRef,
              via: 'webhook',
            });

            this.logger.log(
              JSON.stringify({
                event: 'transfer_failed_and_refunded',
                transaction_id: tx.id,
                sender_id: tx.sender_id,
                amount_kobo: Number(tx.amount),
                squad_ref: squadRef,
              }),
            );
          } else {
            const cur = await this.prisma.transaction.findUnique({
              where: { id: tx.id },
              select: { status: true },
            });

            if (cur?.status === 'FAILED') {
              shouldDedupe = true;
            } else {
              this.logger.warn(
                JSON.stringify({
                  event: 'transfer_fail_failed',
                  transaction_id: tx.id,
                  squad_ref: squadRef,
                  current_status: cur?.status,
                }),
              );
            }
          }
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            JSON.stringify({
              event: 'transfer_fail_error',
              transaction_id: tx.id,
              squad_ref: squadRef,
              error: err.message,
            }),
          );
          throw error;
        }
      } else {
        this.logger.log(
          JSON.stringify({
            event: 'transfer_webhook_pending',
            transaction_id: tx.id,
            squad_ref: squadRef,
            reason: 'Status is neither success nor failed',
          }),
        );
      }

      if (shouldDedupe) {
        await this.redis.set(dedupeKey, true, 86400);
      }

      return { success: true };
    }

    // Unknown transaction type - still mark as processed
    this.logger.warn(
      JSON.stringify({
        event: 'webhook_unknown_transaction_type',
        transaction_id: tx.id,
        type: tx.type,
        squad_ref: squadRef,
      }),
    );

    await this.redis.set(dedupeKey, true, 86400);
    return { success: true };
  }

  /**
   * Cron job to recover webhooks that Squad says were sent but we didn't process
   * Runs every 30 minutes
   */
  @Cron('0 */30 * * * *')
  async recoverMissedWebhooks(): Promise<void> {
    try {
      const missed = await this.squad.getMissedWebhooks();

      if (!Array.isArray(missed) || missed.length === 0) {
        return;
      }

      this.logger.log(
        JSON.stringify({
          event: 'recovering_missed_webhooks',
          count: missed.length,
        }),
      );

      for (const tx of missed) {
        const ref =
          tx?.transaction_ref ||
          tx?.transactionRef ||
          tx?.reference ||
          tx?.data?.transaction_ref ||
          tx?.squad_ref;

        if (!ref) {
          this.logger.warn('Missed webhook has no squad_ref, skipping');
          continue;
        }

        const already = await this.prisma.transaction.findFirst({
          where: { squad_ref: String(ref) },
        });

        if (!already) {
          this.logger.log(
            JSON.stringify({
              event: 'processing_recovered_webhook',
              squad_ref: ref,
            }),
          );

          // Best-effort processing with no signature context
          const virtualAccountNumber =
            tx?.virtual_account_number || tx?.data?.virtual_account_number;
          const amountNaira = tx?.amount || tx?.data?.amount;

          if (virtualAccountNumber && typeof amountNaira === 'number') {
            try {
              await this.wallet.processWebhookPayment(
                String(virtualAccountNumber),
                Math.round(amountNaira * 100),
                String(ref),
              );

              this.logger.log(
                JSON.stringify({
                  event: 'recovered_webhook_processed',
                  squad_ref: ref,
                  amount_naira: amountNaira,
                }),
              );
            } catch (error) {
              const err = error as Error;
              this.logger.error(
                JSON.stringify({
                  event: 'recovered_webhook_processing_failed',
                  squad_ref: ref,
                  error: err.message,
                }),
              );
            }
          }
        }

        try {
          await this.squad.deleteMissedWebhookLog(String(ref));
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            JSON.stringify({
              event: 'failed_to_delete_missed_webhook_log',
              squad_ref: ref,
              error: err.message,
            }),
          );
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        JSON.stringify({
          event: 'recover_missed_webhooks_failed',
          error: err.message,
          stack: err.stack,
        }),
      );
    }
  }

  /**
   * Debug: Get webhook health metrics
   */
  async getWebhookHealthMetrics() {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const completedTransfers = await this.prisma.transaction.count({
      where: {
        type: 'TRANSFER',
        status: 'COMPLETED',
        created_at: { gte: last24h },
      },
    });

    const failedTransfers = await this.prisma.transaction.count({
      where: {
        type: 'TRANSFER',
        status: 'FAILED',
        created_at: { gte: last24h },
      },
    });

    const pendingTransfers = await this.prisma.transaction.count({
      where: {
        type: 'TRANSFER',
        status: 'PENDING',
        created_at: { gte: last24h },
      },
    });

    return {
      period: 'last_24_hours',
      transfers: {
        completed: completedTransfers,
        failed: failedTransfers,
        pending: pendingTransfers,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Debug: Get transactions stuck in PENDING state
   */
  async getPendingTransfers(limit: number = 50) {
    const pending = await this.prisma.transaction.findMany({
      where: {
        type: 'TRANSFER',
        status: 'PENDING',
      },
      include: {
        sender: { select: { id: true, phone: true } },
        recipient: { select: { id: true, phone: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    return pending.map((tx: any) => ({
      id: tx.id,
      sender_id: tx.sender_id,
      recipient_id: tx.recipient_id,
      amount: Number(tx.amount),
      squad_ref: tx.squad_ref,
      created_at: tx.created_at,
      time_pending_minutes: Math.round(
        (Date.now() - new Date(tx.created_at).getTime()) / 60000,
      ),
    }));
  }

  /**
   * Debug: Find transaction by squad_ref
   */
  async findBySquadRef(squadRef: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { squad_ref: squadRef },
      include: {
        sender: { select: { id: true, phone: true, first_name: true } },
        recipient: { select: { id: true, phone: true, first_name: true } },
      },
    });

    if (!tx) {
      return { error: 'Not found', squad_ref: squadRef };
    }

    return {
      id: tx.id,
      squad_ref: tx.squad_ref,
      status: tx.status,
      type: tx.type,
      amount: Number(tx.amount),
      sender: tx.sender,
      recipient: tx.recipient,
      created_at: tx.created_at,
      updated_at: tx.updated_at,
    };
  }
}