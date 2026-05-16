import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { FraudService } from '../common/services/fraud.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { WalletService } from '../wallet/wallet.service';
import { normalizeNgPhone } from '../common/utils/phone.util';
import { resolvePayoutNipCode } from '../common/utils/squad-bank-code.util';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly CONFIRM_TTL_SECONDS = 900; // 15 min

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly fraud: FraudService,
    private readonly squad: SquadService,
    private readonly activityLog: ActivityLogService,
    private readonly wallet: WalletService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  /** Normalise Squad payout requery/webhook-ish status labels. */
  private classifySquadPayoutSettlement(
    label: string,
    raw: Record<string, unknown>,
  ): 'success' | 'failed' | 'pending' {
    const bits = [
      label,
      raw?.status,
      raw?.transaction_status,
      raw?.transfer_status,
      raw?.response_description,
      raw?.payment_status,
      raw?.message,
    ]
      .filter((x) => typeof x === 'string')
      .map((x) => String(x).toLowerCase());

    const combined = bits.join(' ');

    if (
      /\b(success|successful|completed|complete|paid|credited|approved)\b/.test(
        combined,
      )
    ) {
      return 'success';
    }
    if (/\b(fail|failed|reversed|reversal|reject|declin)\b/.test(combined)) {
      return 'failed';
    }

    const rc = raw?.response_code;
    if (rc === '00' || rc === 0 || rc === '0') return 'success';

    return 'pending';
  }

  private resolveRecipientNip(
    recipient: { squad_bank_code: string | null },
    nipCode?: string,
  ): { nip: string; source: string } {
    return resolvePayoutNipCode({
      requestOverride: nipCode,
      squadBankCodeStored: recipient.squad_bank_code,
    });
  }

  /**
   * Resolve payout details for a PayDrop recipient VA.
   * Squad NIP name lookup does not work for PayDrop-provisioned virtual accounts (424);
   * we use the registered KYC name and VA number for P2P preview and payout.
   */
  private resolveRecipientPayoutDetails(
    recipient: {
      first_name: string;
      last_name: string;
      squad_virtual_account: string | null;
      squad_bank_code: string | null;
    },
    nipCode?: string,
    logContext: Record<string, unknown> = {},
  ) {
    if (!recipient.squad_virtual_account) {
      throw new BadRequestException('Recipient cannot receive transfers yet');
    }
    const { nip, source } = this.resolveRecipientNip(recipient, nipCode);
    const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();

    this.logger.log(
      JSON.stringify({
        event: 'paydrop_recipient_payout_resolve',
        lookup_source: 'paydrop_profile',
        squad_virtual_account: recipient.squad_virtual_account,
        nip_code_for_payout: nip,
        nip_code_source: source,
        squad_bank_code_stored: recipient.squad_bank_code,
        registered_name: recipientName,
        ...logContext,
      }),
    );

    return {
      lookup: {
        account_name: recipientName,
        account_number: recipient.squad_virtual_account,
      },
      recipientName,
      nameMatches: true,
      nip,
      lookupSource: 'paydrop_profile' as const,
    };
  }

  /**
   * Shape a transaction row for API responses.
   * Pass viewerUserId to get a 'debit' | 'credit' direction field.
   */
  private formatTx(tx: any, viewerUserId?: string) {
    return {
      id: tx.id,
      sender_id: tx.sender_id,
      recipient_id: tx.recipient_id,
      amount: tx.amount,
      type: tx.type,
      status: tx.status,
      /**
       * direction:
       *   'debit'  – money left the viewer's wallet (they are the sender)
       *   'credit' – money entered the viewer's wallet (they are the recipient)
       *   null     – viewer context unknown (single-tx lookup without auth context)
       */
      direction: viewerUserId
        ? tx.sender_id === viewerUserId
          ? 'debit'
          : 'credit'
        : null,
      note: tx.note,
      squad_ref: tx.squad_ref,
      fraud_score: tx.fraud_score,
      fraud_verdict: tx.verdict,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Public methods
  // ─────────────────────────────────────────────────────────────

  async lookupRecipientSquadPayoutAccount(recipientId: string) {
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    const { lookup, recipientName, nameMatches, nip, lookupSource } =
      await this.resolveRecipientPayoutDetails(recipient, undefined, {
        recipient_id: recipientId,
      });

    return {
      recipient_id: recipientId,
      squad_virtual_account: recipient.squad_virtual_account,
      nip_code: nip,
      lookup_source: lookupSource,
      account_name: lookup.account_name,
      registered_name: recipientName,
      name_matches_registered: nameMatches,
    };
  }

  async requerySquadTransfer(userId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!tx || (tx.sender_id !== userId && tx.recipient_id !== userId)) {
      throw new NotFoundException('Transaction not found');
    }
    if (!tx.squad_ref) {
      throw new BadRequestException(
        'Transaction has no Squad payout reference yet',
      );
    }

    const result = await this.squad.requeryTransfer(tx.squad_ref);
    const settlement = this.classifySquadPayoutSettlement(
      result.status,
      result.raw,
    );

    let paydrop_settlement:
      | 'unchanged'
      | 'completed'
      | 'failed'
      | 'not_applicable' = 'unchanged';

    if (tx.type === 'TRANSFER') {
      if (settlement === 'success') {
        const applied = await this.wallet.completePendingP2pTransfer(tx.id);
        if (applied) {
          paydrop_settlement = 'completed';
          await this.redis.set(`squad_ref:${tx.squad_ref}`, '1', 86400);
        } else {
          const cur = await this.prisma.transaction.findUnique({
            where: { id: tx.id },
            select: { status: true },
          });
          if (cur?.status === 'COMPLETED') {
            await this.redis.set(`squad_ref:${tx.squad_ref}`, '1', 86400);
          }
        }
      } else if (settlement === 'failed') {
        const applied = await this.wallet.failPendingP2pTransfer(tx.id);
        if (applied) {
          paydrop_settlement = 'failed';
          await this.redis.set(`squad_ref:${tx.squad_ref}`, '1', 86400);
        } else {
          const cur = await this.prisma.transaction.findUnique({
            where: { id: tx.id },
            select: { status: true },
          });
          if (cur?.status === 'FAILED') {
            await this.redis.set(`squad_ref:${tx.squad_ref}`, '1', 86400);
          }
        }
      }
      // else: settlement === 'pending' → paydrop_settlement stays 'unchanged'
    } else {
      paydrop_settlement = 'not_applicable';
    }

    const fresh = await this.prisma.transaction.findUnique({
      where: { id: tx.id },
      select: { status: true },
    });

    return {
      transaction_id: tx.id,
      squad_ref: tx.squad_ref,
      squad_settlement_hint: settlement,
      paydrop_settlement_applied: paydrop_settlement,
      paydrop_transaction_status: fresh?.status,
      ...result,
    };
  }

  /**
   * How many of the requester's address-book contacts (by phone) use PayDrop,
   * and how many distinct contacts have completed a prior transfer to the recipient.
   */
  async recipientContactTransferInsight(
    requesterUserId: string,
    recipientId: string,
    contactPhones: string[],
  ) {
    if (recipientId === requesterUserId) {
      throw new BadRequestException('Cannot use yourself as transfer recipient');
    }

    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    const normalizedUnique = [
      ...new Set(
        contactPhones
          .map((p) => (typeof p === 'string' ? p.trim() : ''))
          .filter((p) => p.length > 0)
          .map((p) => normalizeNgPhone(p)),
      ),
    ];

    if (normalizedUnique.length === 0) {
      throw new BadRequestException(
        'contacts must include at least one valid phone',
      );
    }

    const matchedUsers = await this.prisma.user.findMany({
      where: { phone: { in: normalizedUnique } },
      select: { id: true, phone: true },
    });

    const matchedIds = [
      ...new Set(matchedUsers.map((u: { id: string }) => u.id)),
    ];
    const friendCandidateIds = matchedIds.filter(
      (id) => id !== requesterUserId && id !== recipientId,
    );

    let friendsWhoTransferred = 0;
    if (friendCandidateIds.length > 0) {
      const grouped = await this.prisma.transaction.groupBy({
        by: ['sender_id'],
        where: {
          recipient_id: recipientId,
          type: 'TRANSFER',
          status: 'COMPLETED',
          sender_id: { in: friendCandidateIds },
        },
      });
      friendsWhoTransferred = grouped.length;
    }

    return {
      recipient_id: recipientId,
      contacts_submitted: contactPhones.length,
      distinct_phones_normalized: normalizedUnique.length,
      contacts_matched_on_paydrop: matchedIds.length,
      friends_who_transferred_to_recipient: friendsWhoTransferred,
    };
  }

  async transfer(
    senderId: string,
    recipientId: string,
    amount: number,
    note?: string,
    nipCode?: string,
  ) {
    if (recipientId === senderId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    const idempotencyKey = uuidv4();
    const amountKobo = BigInt(amount);

    if (amountKobo <= 0n) {
      throw new BadRequestException(
        'Amount must be greater than zero (value is in kobo)',
      );
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

    const fraud = await this.fraud.scoreTransaction({
      idempotency_key: idempotencyKey,
      sender_id: senderId,
      recipient_id: recipientId,
      amount: Number(amountKobo),
    });

    await this.activityLog.log(senderId, 'TRANSFER_FRAUD_SCORED', {
      score: fraud.score,
      verdict: fraud.verdict,
      reason: fraud.reason,
    });

    // ── BLOCK ──────────────────────────────────────────────────
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

    // ── FLAG ───────────────────────────────────────────────────
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
      const { nip: recipientNipCode } = this.resolveRecipientNip(
        recipient,
        nipCode,
      );
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
        idempotency_key: idempotencyKey,
        transaction_id: tx.id,
        status: 'PENDING_REVIEW',
        fraud_score: fraud.score,
        verdict: 'FLAG',
        reason: fraud.reason,
        confirm_token: confirmToken,
      };
    }

    // ── ALLOW: pessimistic lock → Squad → create PENDING ──────
    const created = (await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${senderId} FOR UPDATE`;

      const lockedWallet = await tx.wallet.findUnique({
        where: { user_id: senderId },
      });
      if (!lockedWallet || lockedWallet.balance < amountKobo) {
        throw new BadRequestException('Insufficient funds');
      }

      const { lookup, recipientName, nameMatches, nip } =
        await this.resolveRecipientPayoutDetails(recipient, nipCode, {
          sender_id: senderId,
          recipient_id: recipientId,
          flow: 'transfer',
        });
      if (!nameMatches) {
        throw new BadRequestException('Recipient account name mismatch');
      }

      const squadTransfer = await this.squad.initiateTransfer(
        Number(amountKobo),
        nip,
        recipient.squad_virtual_account!,
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

      return {
        txRow,
        squadRef: squadTransfer.transaction_ref,
        nipRef: squadTransfer.nip_transaction_reference,
      };
    })) as { txRow: any; squadRef: string; nipRef?: string };

    // TRANSFER_SENT – logged for the sender after the Squad call succeeds
    await this.activityLog.log(senderId, 'TRANSFER_SENT', {
      transaction_id: created.txRow.id,
      recipient_id: recipientId,
      amount: Number(amountKobo),
      squad_ref: created.squadRef,
    });

    // TRANSFER_INITIATED – kept for backwards compatibility / audit trail
    await this.activityLog.log(senderId, 'TRANSFER_INITIATED', {
      transaction_id: created.txRow.id,
      recipient_id: recipientId,
      amount: Number(amountKobo),
      squad_ref: created.squadRef,
    });

    return {
      idempotency_key: idempotencyKey,
      transaction_id: created.txRow.id,
      status: 'PENDING',
      fraud_score: fraud.score,
      verdict: 'ALLOW',
      squad_ref: created.squadRef,
      nip_transaction_reference: created.nipRef,
    };
  }

  async confirmTransfer(
    senderId: string,
    transactionId: string,
    confirmToken: string,
  ) {
    const payload = await this.redis.get<any>(`confirm:${confirmToken}`);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired confirm token');
    }
    if (
      payload.transaction_id !== transactionId ||
      payload.sender_id !== senderId
    ) {
      throw new UnauthorizedException('Confirm token mismatch');
    }

    await this.redis.del(`confirm:${confirmToken}`);

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    // If already progressed past PENDING_REVIEW (e.g. re-submit after success), return current state
    if (tx.status !== 'PENDING_REVIEW') {
      return {
        idempotency_key: tx.idempotency_key,
        transaction_id: tx.id,
        status: tx.status,
        fraud_score: tx.fraud_score,
        verdict: tx.verdict,
        squad_ref: tx.squad_ref,
      };
    }

    const recipient = await this.prisma.user.findUnique({
      where: { id: tx.recipient_id || '' },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    const nipOverride = (payload as any)?.nip_code;
    const nipFromPayload =
      typeof nipOverride === 'string' && nipOverride.trim().length > 0
        ? nipOverride.trim()
        : undefined;

    const initiated = (await this.prisma.$transaction(async (p: any) => {
      await p.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${senderId} FOR UPDATE`;

      const lockedWallet = await p.wallet.findUnique({
        where: { user_id: senderId },
      });
      if (!lockedWallet || lockedWallet.balance < tx.amount) {
        throw new BadRequestException('Insufficient funds');
      }

      const { lookup, recipientName, nameMatches, nip } =
        await this.resolveRecipientPayoutDetails(recipient, nipFromPayload, {
          sender_id: senderId,
          recipient_id: recipient.id,
          flow: 'transfer_confirm',
        });
      if (!nameMatches) {
        throw new BadRequestException('Recipient account name mismatch');
      }

      const squadTransfer = await this.squad.initiateTransfer(
        Number(tx.amount),
        nip,
        recipient.squad_virtual_account!,
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

    // Also log TRANSFER_SENT now that the flagged transfer has been confirmed and dispatched
    await this.activityLog.log(senderId, 'TRANSFER_SENT', {
      transaction_id: tx.id,
      squad_ref: initiated.squadRef,
      via: 'flag_confirm',
    });

    return {
      idempotency_key: initiated.updated.idempotency_key,
      transaction_id: initiated.updated.id,
      status: initiated.updated.status,
      fraud_score: initiated.updated.fraud_score,
      verdict: initiated.updated.verdict,
      squad_ref: initiated.squadRef,
    };
  }

  async getTransactions(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          OR: [{ sender_id: userId }, { recipient_id: userId }],
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.transaction.count({
        where: {
          OR: [{ sender_id: userId }, { recipient_id: userId }],
        },
      }),
    ]);

    return {
      transactions: transactions.map((tx: any) => this.formatTx(tx, userId)),
      total,
      page,
      limit,
    };
  }

  /**
   * @param viewerUserId  Pass the authenticated user's ID to get a direction field.
   *                      Omit (or pass undefined) for admin/internal lookups.
   */
  async getTransaction(transactionId: string, viewerUserId?: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    return this.formatTx(transaction, viewerUserId);
  }

  async getFraudDetail(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const fraudEvent = await this.prisma.fraudEvent.findFirst({
      where: { transaction_id: transactionId },
    });

    if (fraudEvent) {
      this.logger.log(
        JSON.stringify({
          event: 'fraud_detail_served',
          transaction_id: transactionId,
          source: 'fraud_event',
        }),
      );
      return {
        score: fraudEvent.score,
        verdict: fraudEvent.verdict,
        reason: fraudEvent.reason,
        features: fraudEvent.features as Record<string, unknown>,
        source: 'fraud_event',
        note: 'Full row from fraud_events table (manual review / legacy flow).',
      };
    }

    if (
      transaction.fraud_score != null ||
      transaction.verdict != null ||
      transaction.fraud_reason != null
    ) {
      this.logger.log(
        JSON.stringify({
          event: 'fraud_detail_served',
          transaction_id: transactionId,
          source: 'transaction_snapshot',
          reminder:
            'GET /fraud-detail does not call FRAUD_SERVICE_URL. FraudService runs only when the transfer is created; check logs from that time for fraud_service_unavailable.',
        }),
      );
      return {
        score: transaction.fraud_score ?? 0,
        verdict: transaction.verdict ?? 'ALLOW',
        reason:
          transaction.fraud_reason ??
          'Fraud verdict stored on transaction (external fraud microservice scores are not persisted as FraudEvent rows).',
        features: {} as Record<string, unknown>,
        source: 'transaction_snapshot',
        scored_at: transaction.created_at.toISOString(),
        note: 'Snapshot from when this transfer was scored (POST /transactions/transfer).',
      };
    }

    throw new NotFoundException('No fraud scoring data for this transaction');
  }
}