import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { SquadService } from '../common/services/squad.service';
import { WalletService } from '../wallet/wallet.service';
import { ActivityLogService } from '../common/services';

/**
 * Auto-credit service that polls for pending transfers
 * This runs every 30 seconds and checks Squad for status
 * Does NOT depend on webhooks
 */
@Injectable()
export class AutoCreditService {
  private readonly logger = new Logger(AutoCreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly squad: SquadService,
    private readonly wallet: WalletService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Run every 30 seconds: Find PENDING transfers and check Squad status
   */
  @Cron('*/30 * * * * *') // Every 30 seconds
  async checkPendingTransfers(): Promise<void> {
    try {
      // Get all PENDING transfers
      const pending = await this.prisma.transaction.findMany({
        where: {
          type: 'TRANSFER',
          status: 'PENDING',
          created_at: {
            // Only check transfers from last 10 minutes (don't check ancient ones)
            gte: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
        include: {
          sender: { select: { id: true } },
          recipient: { select: { id: true } },
        },
      });

      if (pending.length === 0) {
        return;
      }

      this.logger.log(
        JSON.stringify({
          event: 'auto_credit_checking_pending',
          count: pending.length,
        }),
      );

      // Check each one with Squad
      for (const tx of pending) {
        if (!tx.squad_ref) {
          this.logger.warn(
            JSON.stringify({
              event: 'pending_transfer_no_squad_ref',
              transaction_id: tx.id,
            }),
          );
          continue;
        }

        try {
          // Ask Squad: what's the status?
          const squadStatus = await this.squad.requeryTransfer(tx.squad_ref);

          // Classify the response
          const isSuccess = this.classifySquadStatus(squadStatus);

          if (isSuccess) {
            // Squad says SUCCESS → Credit the user now!
            await this.creditPendingTransfer(tx);
          } else {
            const isFailed = this.classifySquadStatusFailed(squadStatus);
            if (isFailed) {
              // Squad says FAILED → Refund the sender
              await this.failPendingTransfer(tx);
            }
            // Otherwise still PENDING → wait for next check
          }
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            JSON.stringify({
              event: 'auto_credit_requery_failed',
              transaction_id: tx.id,
              squad_ref: tx.squad_ref,
              error: err.message,
            }),
          );
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        JSON.stringify({
          event: 'auto_credit_check_failed',
          error: err.message,
          stack: err.stack,
        }),
      );
    }
  }

  /**
   * Credit a pending transfer based on Squad success
   */
  private async creditPendingTransfer(tx: any): Promise<void> {
    try {
      // Apply the credit
      const applied = await this.wallet.completePendingP2pTransfer(tx.id);

      if (applied) {
        this.logger.log(
          JSON.stringify({
            event: 'auto_credit_applied',
            transaction_id: tx.id,
            sender_id: tx.sender_id,
            recipient_id: tx.recipient_id,
            amount: Number(tx.amount),
            squad_ref: tx.squad_ref,
            reason: 'auto_credit_poll',
          }),
        );

        // Log activity for both users
        await this.activityLog.log(tx.sender_id, 'TRANSFER_COMPLETED', {
          transaction_id: tx.id,
          recipient_id: tx.recipient_id,
          amount: Number(tx.amount),
          squad_ref: tx.squad_ref,
          via: 'auto_credit_poll',
        });

        await this.activityLog.log(tx.recipient_id, 'TRANSFER_RECEIVED', {
          transaction_id: tx.id,
          sender_id: tx.sender_id,
          amount: Number(tx.amount),
          squad_ref: tx.squad_ref,
          via: 'auto_credit_poll',
        });
      } else {
        // Already credited by webhook or previous check
        this.logger.log(
          JSON.stringify({
            event: 'auto_credit_already_applied',
            transaction_id: tx.id,
            reason: 'webhook arrived first or already processed',
          }),
        );
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        JSON.stringify({
          event: 'auto_credit_failed',
          transaction_id: tx.id,
          error: err.message,
          stack: err.stack,
        }),
      );
    }
  }

  /**
   * Fail a pending transfer
   */
  private async failPendingTransfer(tx: any): Promise<void> {
    try {
      const applied = await this.wallet.failPendingP2pTransfer(tx.id);

      if (applied) {
        this.logger.log(
          JSON.stringify({
            event: 'auto_credit_transfer_failed',
            transaction_id: tx.id,
            sender_id: tx.sender_id,
            amount: Number(tx.amount),
            squad_ref: tx.squad_ref,
            reason: 'Squad rejected transfer',
          }),
        );

        await this.activityLog.log(tx.sender_id, 'TRANSFER_FAILED', {
          transaction_id: tx.id,
          recipient_id: tx.recipient_id,
          amount: Number(tx.amount),
          squad_ref: tx.squad_ref,
          via: 'auto_credit_poll',
        });
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        JSON.stringify({
          event: 'auto_credit_fail_failed',
          transaction_id: tx.id,
          error: err.message,
        }),
      );
    }
  }

  /**
   * Check if Squad response indicates success
   */
  private classifySquadStatus(response: any): boolean {
    const status =
      response?.status ||
      response?.data?.status ||
      response?.paydrop_transaction_status ||
      '';

    const statusLower = String(status).toLowerCase();

    return (
      statusLower.includes('success') ||
      statusLower.includes('completed') ||
      statusLower.includes('paid') ||
      statusLower.includes('credited') ||
      response?.raw?.response_code === '000' ||
      response?.raw?.response_code === '00'
    );
  }

  /**
   * Check if Squad response indicates failure
   */
  private classifySquadStatusFailed(response: any): boolean {
    const status =
      response?.status ||
      response?.data?.status ||
      response?.paydrop_transaction_status ||
      '';

    const statusLower = String(status).toLowerCase();

    return (
      statusLower.includes('fail') ||
      statusLower.includes('reject') ||
      statusLower.includes('decline') ||
      statusLower.includes('reversed')
    );
  }
}