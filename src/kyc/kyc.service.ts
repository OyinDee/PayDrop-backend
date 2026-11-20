import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { UsersService } from '../users/users.service';
import { apiError } from '../common/errors/api-error';
import { enforceRateLimit } from '../common/utils/rate-limit.util';
import { maskBvn } from '../common/utils/crypto.util';

export interface KycLimits {
  per_transfer: number;
  daily: number;
  max_balance: number;
}

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly activityLog: ActivityLogService,
    private readonly usersService: UsersService,
  ) {}

  /** Limits are a compliance decision; they stay 0 until configured. */
  private limitsForTier(tier: number): KycLimits {
    const prefix = tier >= 1 ? 'KYC_TIER1' : 'KYC_TIER0';
    return {
      per_transfer: Number(process.env[`${prefix}_PER_TRANSFER`] || 0),
      daily: Number(process.env[`${prefix}_DAILY`] || 0),
      max_balance: Number(process.env[`${prefix}_MAX_BALANCE`] || 0),
    };
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found.');
    }

    const tier = Number((user as any).kyc_tier ?? 0);

    return {
      kyc_status:
        (user as any).kyc_status ??
        (user.kyc_verified ? 'VERIFIED' : 'NOT_STARTED'),
      tier,
      rejection_reason: (user as any).kyc_rejection_reason ?? null,
      limits: this.limitsForTier(tier),
      next_tier: {
        tier: tier + 1,
        ...this.limitsForTier(tier + 1),
      },
    };
  }

  /**
   * Optional KYC: BVN + date of birth, verified through Squad's virtual-account
   * creation. Never required to hold an account or receive money.
   */
  async verify(userId: string, input: { bvn?: string; dob?: string }) {
    const bvn = String(input.bvn ?? '').replace(/\D/g, '');
    const dob = String(input.dob ?? '').trim();

    if (!/^\d{11}$/.test(bvn)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'BVN must be exactly 11 digits.',
        { field: 'bvn' },
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Date of birth must be YYYY-MM-DD.',
        { field: 'dob' },
      );
    }

    // 3 submissions per user per day.
    await enforceRateLimit(this.redis, {
      key: `kyc_verify:${userId}`,
      limit: 3,
      windowSeconds: 86400,
      message: 'Too many KYC attempts today. Contact support if this keeps failing.',
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found.');
    }

    if (user.kyc_verified) {
      throw apiError(
        HttpStatus.CONFLICT,
        'KYC_ALREADY_VERIFIED',
        'Your account is already verified.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kyc_status: 'PENDING',
        kyc_bvn_last4: maskBvn(bvn).slice(-4),
        kyc_submitted_at: new Date(),
        kyc_rejection_reason: null,
      },
    });

    await this.activityLog.log(userId, 'KYC_SUBMITTED', {
      bvn_last4: maskBvn(bvn).slice(-4),
      consented_at: new Date().toISOString(),
    });

    try {
      await this.usersService.verifyKyc(userId, { bvn, dob });
    } catch (error: any) {
      const reason =
        error?.response?.data?.message ||
        error?.message ||
        'Details do not match our records.';

      // A mismatch is a soft failure: the user may retry, the account stays open.
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          kyc_status: 'REJECTED',
          kyc_rejection_reason: String(reason).slice(0, 500),
        },
      });

      await this.activityLog.log(userId, 'KYC_REJECTED', {
        reason: String(reason).slice(0, 200),
      });

      throw apiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'KYC_MISMATCH',
        'Details do not match our records. Check your BVN and date of birth and try again.',
      );
    }

    await this.activityLog.log(userId, 'KYC_VERIFIED', { source: 'kyc_verify' });

    return { kyc_status: 'VERIFIED' };
  }
}
