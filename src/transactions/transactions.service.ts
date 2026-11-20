import {
  Injectable,
  BadRequestException,
  NotFoundException,
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
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeNgPhone } from '../common/utils/phone.util';
import { resolvePayoutNipCode } from '../common/utils/squad-bank-code.util';
import { apiError } from '../common/errors/api-error';
import { HttpStatus } from '@nestjs/common';

/** Format kobo as a readable naira string: 50000 → "₦500.00" */
function naira(kobo: number | bigint): string {
  return (Number(kobo) / 100).toLocaleString('en-NG', {
    style: 'currency',
    currency: 'NGN',
  });
}

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
    private readonly notifications: NotificationsService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

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
    )
      return 'success';
    if (/\b(fail|failed|reversed|reversal|reject|declin)\b/.test(combined))
      return 'failed';

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

  private formatTx(
    tx: any,
    viewerUserId?: string,
    profiles?: Map<string, any>,
  ) {
    const isSender =
      viewerUserId && tx.sender_id ? tx.sender_id === viewerUserId : null;
    const counterpartyId = isSender ? tx.recipient_id : tx.sender_id;

    return {
      id: tx.id,
      amount: Number(tx.amount),
      amount_kobo: Number(tx.amount),
      currency: 'NGN',
      status: tx.status,
      direction:
        isSender === null ? null : isSender ? 'sent' : 'received',
      type: tx.type,
      note: tx.note ?? null,
      sender_id: tx.sender_id ?? null,
      recipient_id: tx.recipient_id ?? null,
      counterparty: profiles?.get(counterpartyId) ?? null,
      squad_ref: tx.squad_ref ?? null,
      fraud_score: tx.fraud_score ?? null,
      verdict: tx.verdict ?? 'ALLOW',
      fraud_reason: tx.fraud_reason ?? null,
      created_at: tx.created_at,
      updated_at: tx.updated_at,
    };
  }

  /** Minimal public profile for everyone in a page of transactions. */
  private async counterpartyProfiles(rows: any[]) {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.sender_id) ids.add(row.sender_id);
      if (row.recipient_id) ids.add(row.recipient_id);
    }

    const map = new Map<string, any>();
    if (ids.size === 0) return map;

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(ids) } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        avatar_url: true,
      },
    });

    for (const user of users as any[]) {
      map.set(user.id, {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name ?? null,
        username: user.username ?? null,
        avatar_url: user.avatar_url ?? null,
      });
    }

    return map;
  }

  /** The canonical transfer body the app reads (id, amount, recipient). */
  private buildTransferResponse(tx: any, recipient: any) {
    return {
      id: tx.id,
      amount: Number(tx.amount),
      currency: 'NGN',
      status: tx.status,
      verdict: tx.verdict ?? 'ALLOW',
      recipient: recipient
        ? {
            id: recipient.id,
            first_name: recipient.first_name,
            last_name: recipient.last_name ?? null,
            username: recipient.username ?? null,
            avatar_url: recipient.avatar_url ?? null,
          }
        : null,
      created_at: tx.created_at ?? null,
    };
  }

  /**
   * Same key + same payload returns the original payment; same key with a
   * different payload is a 409 (requirements 5.5).
   */
  private async findIdempotentTransfer(
    senderId: string,
    key: string,
    recipientId: string,
    amount: number,
    note?: string | null,
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { idempotency_key: key },
    });

    if (!tx) return null;

    if (tx.sender_id !== senderId) {
      throw apiError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'That idempotency key belongs to another payment.',
        { idempotency_key: key },
      );
    }

    const samePayload =
      tx.recipient_id === recipientId &&
      Number(tx.amount) === Number(amount) &&
      (tx.note ?? null) === (note ?? null);

    if (!samePayload) {
      throw apiError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was already used for a different payment.',
        { idempotency_key: key, transaction_id: tx.id },
      );
    }

    return tx;
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
    clientIdempotencyKey?: string,
  ) {
    if (recipientId === senderId) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'You cannot send money to yourself.',
        { field: 'recipient_id' },
      );
    }

    const amountKobo = BigInt(amount);

    if (amountKobo <= 0n) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Amount must be greater than zero (value is in kobo).',
        { field: 'amount' },
      );
    }

    const idempotencyKey = (clientIdempotencyKey ?? '').trim() || uuidv4();

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      include: { wallet: true },
    });
    if (!sender?.wallet) throw new NotFoundException('Sender wallet not found');

    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    if (clientIdempotencyKey) {
      const replay = await this.findIdempotentTransfer(
        senderId,
        idempotencyKey,
        recipientId,
        Number(amountKobo),
        note,
      );
      if (replay) {
        return this.buildTransferResponse(replay, recipient);
      }

      const reserved = await this.redis.setIfNotExists(
        `idem_lock:${senderId}:${idempotencyKey}`,
        '1',
        60,
      );
      if (!reserved) {
        const raced = await this.findIdempotentTransfer(
          senderId,
          idempotencyKey,
          recipientId,
          Number(amountKobo),
          note,
        );
        if (raced) return this.buildTransferResponse(raced, recipient);

        throw apiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'That payment is already being processed. Check its status before retrying.',
          { idempotency_key: idempotencyKey },
        );
      }
    }

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
      const blockedTx = await this.prisma.transaction.create({
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

      await this.notifications.send(
        senderId,
        'Transfer blocked',
        `Your transfer of ${naira(amountKobo)} was blocked for security reasons. Contact support if you think this is an error.`,
      );

      throw apiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'TRANSFER_BLOCKED',
        fraud.reason || 'This payment was blocked for security reasons.',
        {
          transaction_id: blockedTx.id,
          verdict: 'BLOCK',
          status: 'BLOCKED',
          fraud_score: fraud.score,
        },
      );
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

      await this.notifications.send(
        senderId,
        'Transfer needs your confirmation',
        `Your transfer of ${naira(amountKobo)} requires additional verification. Please confirm to proceed.`,
      );

      return {
        ...this.buildTransferResponse(tx, recipient),
        id: tx.id,
        status: 'PENDING_REVIEW',
        fraud_score: fraud.score,
        verdict: 'FLAG',
        reason: fraud.reason,
        message: fraud.reason,
        confirm_token: confirmToken,
        confirm_token_expires_at: new Date(
          Date.now() + this.CONFIRM_TTL_SECONDS * 1000,
        ).toISOString(),
        expires_at: new Date(
          Date.now() + this.CONFIRM_TTL_SECONDS * 1000,
        ).toISOString(),
        idempotency_key: idempotencyKey,
        transaction_id: tx.id,
      };
    }

    // ── ALLOW ──────────────────────────────────────────────────
    // Step 1: Resolve recipient payout details (no DB writes, safe outside tx)
    const { lookup, recipientName, nameMatches, nip } =
      this.resolveRecipientPayoutDetails(recipient, nipCode, {
        sender_id: senderId,
        recipient_id: recipientId,
        flow: 'transfer',
      });
    if (!nameMatches) {
      throw new BadRequestException('Recipient account name mismatch');
    }

    // Step 2: Balance pre-check before calling Squad (avoid unnecessary API call)
    const walletPreCheck = await this.prisma.wallet.findUnique({
      where: { user_id: senderId },
    });
    if (!walletPreCheck || walletPreCheck.balance < amountKobo) {
      throw new BadRequestException('Insufficient funds');
    }

    // Step 3: Call Squad OUTSIDE the transaction — this is the slow external call
    const squadTransfer = await this.squad.initiateTransfer(
      Number(amountKobo),
      nip,
      recipient.squad_virtual_account!,
      lookup.account_name || recipientName,
      'PayDrop P2P Transfer',
    );

    // Step 4: Short DB-only transaction — pessimistic lock + recheck + insert
    const created = (await this.prisma.$transaction(
      async (tx: any) => {
        await tx.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${senderId} FOR UPDATE`;

        const lockedWallet = await tx.wallet.findUnique({
          where: { user_id: senderId },
        });

        // If balance check fails after Squad was already called, record the
        // transaction as PENDING so the ref isn't lost — the requery cron /
        // webhook will settle it (or it will bounce back from Squad's side).
        if (!lockedWallet || lockedWallet.balance < amountKobo) {
          await tx.transaction.create({
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
          throw new BadRequestException('Insufficient funds');
        }

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
          recipientName,
        };
      },
    )) as {
      txRow: any;
      squadRef: string;
      nipRef?: string;
      recipientName: string;
    };

    const senderName = `${sender.first_name} ${sender.last_name}`.trim();

    await this.activityLog.log(senderId, 'TRANSFER_SENT', {
      transaction_id: created.txRow.id,
      recipient_id: recipientId,
      amount: Number(amountKobo),
      squad_ref: created.squadRef,
    });

    await this.activityLog.log(senderId, 'TRANSFER_INITIATED', {
      transaction_id: created.txRow.id,
      recipient_id: recipientId,
      amount: Number(amountKobo),
      squad_ref: created.squadRef,
    });

    await this.notifications.send(
      senderId,
      'Transfer sent',
      `Your transfer of ${naira(amountKobo)} to ${created.recipientName} is being processed.`,
    );

    await this.notifications.send(
      recipientId,
      'Incoming transfer',
      `${senderName} is sending you ${naira(amountKobo)}. It will reflect once confirmed.`,
    );

    return {
      ...this.buildTransferResponse(created.txRow, recipient),
      id: created.txRow.id,
      status: 'PENDING',
      fraud_score: fraud.score,
      verdict: 'ALLOW',
      squad_ref: created.squadRef,
      nip_transaction_reference: created.nipRef,
      idempotency_key: idempotencyKey,
      transaction_id: created.txRow.id,
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

    if (tx.status !== 'PENDING_REVIEW') {
      return {
        id: tx.id,
        amount: Number(tx.amount),
        status: tx.status,
        fraud_score: tx.fraud_score,
        verdict: tx.verdict,
        squad_ref: tx.squad_ref,
        idempotency_key: tx.idempotency_key,
        transaction_id: tx.id,
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

    // Step 1: Resolve recipient payout details outside the transaction
    const { lookup, recipientName, nameMatches, nip } =
      this.resolveRecipientPayoutDetails(recipient, nipFromPayload, {
        sender_id: senderId,
        recipient_id: recipient.id,
        flow: 'transfer_confirm',
      });
    if (!nameMatches) {
      throw new BadRequestException('Recipient account name mismatch');
    }

    // Step 2: Balance pre-check before calling Squad
    const walletPreCheck = await this.prisma.wallet.findUnique({
      where: { user_id: senderId },
    });
    if (!walletPreCheck || walletPreCheck.balance < tx.amount) {
      throw new BadRequestException('Insufficient funds');
    }

    // Step 3: Call Squad OUTSIDE the transaction
    const squadTransfer = await this.squad.initiateTransfer(
      Number(tx.amount),
      nip,
      recipient.squad_virtual_account!,
      lookup.account_name || recipientName,
      'PayDrop P2P Transfer',
    );

    // Step 4: Short DB-only transaction — pessimistic lock + recheck + update
    const initiated = (await this.prisma.$transaction(
      async (p: any) => {
        await p.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${senderId} FOR UPDATE`;

        const lockedWallet = await p.wallet.findUnique({
          where: { user_id: senderId },
        });
        if (!lockedWallet || lockedWallet.balance < tx.amount) {
          // Squad already called — update the row with the ref so it can be
          // reconciled, then surface the error to the caller.
          await p.transaction.update({
            where: { id: tx.id },
            data: { squad_ref: squadTransfer.transaction_ref },
          });
          throw new BadRequestException('Insufficient funds');
        }

        const updated = await p.transaction.update({
          where: { id: tx.id },
          data: { status: 'PENDING', squad_ref: squadTransfer.transaction_ref },
        });

        return { updated, squadRef: squadTransfer.transaction_ref, recipientName };
      },
    )) as { updated: any; squadRef: string; recipientName: string };

    await this.activityLog.log(senderId, 'TRANSFER_FLAG_CONFIRMED', {
      transaction_id: tx.id,
      squad_ref: initiated.squadRef,
    });

    await this.activityLog.log(senderId, 'TRANSFER_SENT', {
      transaction_id: tx.id,
      squad_ref: initiated.squadRef,
      via: 'flag_confirm',
    });

    await this.notifications.send(
      senderId,
      'Transfer confirmed',
      `Your transfer of ${naira(tx.amount)} to ${initiated.recipientName} is now being processed.`,
    );

    return {
      ...this.buildTransferResponse(initiated.updated, recipient),
      id: initiated.updated.id,
      status: initiated.updated.status,
      fraud_score: initiated.updated.fraud_score,
      verdict: initiated.updated.verdict,
      squad_ref: initiated.squadRef,
      idempotency_key: initiated.updated.idempotency_key,
      transaction_id: initiated.updated.id,
    };
  }

async getTransactions(userId: string, page: number = 1, limit: number = 10) {
    if (page < 1) page = 1;
    limit = Math.min(Math.max(Number(limit) || 10, 1), 100);

    const skip = (page - 1) * limit;
    const where = {
      OR: [{ sender_id: userId }, { recipient_id: userId }],
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const profiles = await this.counterpartyProfiles(transactions as any[]);

    return {
      transactions: transactions.map((tx: any) =>
        this.formatTx(tx, userId, profiles),
      ),
      total,
      page,
      limit,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * GET /transactions/by-idempotency-key/:key — recovery when the submit
   * response never arrived. Scoped to the caller; a stranger's key is a 404.
   */
  async getTransactionByIdempotencyKey(userId: string, key: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { idempotency_key: key },
    });

    if (!tx || (tx.sender_id !== userId && tx.recipient_id !== userId)) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'No payment found for that idempotency key.',
        { idempotency_key: key },
      );
    }

    const profiles = await this.counterpartyProfiles([tx as any]);

    return this.formatTx(tx, userId, profiles);
  }

  async getTransaction(transactionId: string, viewerUserId?: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    // A user may only read transactions they are part of.
    if (
      !transaction ||
      (viewerUserId &&
        transaction.sender_id !== viewerUserId &&
        transaction.recipient_id !== viewerUserId)
    ) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'Transaction not found.',
      );
    }

    const profiles = await this.counterpartyProfiles([transaction as any]);

    return this.formatTx(transaction, viewerUserId, profiles);
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