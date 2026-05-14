import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { SquadService } from '../common/services/squad.service';
import { resolveUserAvatarUrl } from '../common/utils/avatar.util';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly squad: SquadService,
  ) {}

  /**
   * Get current user profile with wallet balance
   */
  async getProfile(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      phone: user.phone,
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      avatar_url: resolveUserAvatarUrl(user),
      squad_virtual_account: user.squad_virtual_account,
      squad_bank_code: user.squad_bank_code,
      kyc_verified: user.kyc_verified,
      wallet: {
        balance: user.wallet?.balance || 0n,
        currency: 'NGN',
      },
    };
  }

  /**
   * Update user profile (name, email, avatar)
   */
  /**
   * Complete KYC using Squad virtual-account creation (BVN + identity validated by Squad).
   * Use when a legacy user has no VA yet, or to align stored identity with BVN.
   */
  async verifyKyc(
    userId: string,
    data: { bvn: string; dob: string },
  ): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.kyc_verified && user.squad_virtual_account) {
      return {
        kyc_verified: true,
        message: 'KYC already completed',
      };
    }

    if (user.squad_virtual_account && !user.kyc_verified) {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { kyc_verified: true },
      });
      await this.activityLog.log(userId, 'KYC_BVN_VERIFIED', {
        source: 'profile_backfill',
      });
      return {
        kyc_verified: updated.kyc_verified,
        squad_virtual_account: updated.squad_virtual_account,
        squad_bank_code: updated.squad_bank_code,
      };
    }

    const squadAccount = await this.squad.createVirtualAccount(
      userId,
      user.first_name,
      user.last_name,
      user.phone,
      user.email || undefined,
      { bvn: data.bvn, dob: data.dob },
    );

    const provisioned = (await this.prisma.$transaction(async (tx: any) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          squad_virtual_account: squadAccount.virtual_account_number,
          squad_bank_code: squadAccount.bank_code,
          kyc_verified: true,
        },
      });

      let wallet = await tx.wallet.findUnique({
        where: { user_id: userId },
      });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            user_id: userId,
            balance: 0n,
            currency: 'NGN',
          },
        });
      }

      return { updated, wallet };
    })) as { updated: any; wallet: any };

    await this.activityLog.log(userId, 'KYC_BVN_VERIFIED', {
      source: 'verify_kyc_endpoint',
    });

    return {
      kyc_verified: provisioned.updated.kyc_verified,
      squad_virtual_account: provisioned.updated.squad_virtual_account,
      squad_bank_code: provisioned.updated.squad_bank_code,
      wallet: {
        balance: provisioned.wallet.balance,
        currency: provisioned.wallet.currency,
      },
    };
  }

  async updateProfile(
    userId: string,
    data: {
      first_name?: string;
      last_name?: string;
      email?: string;
      avatar_url?: string;
    },
  ): Promise<any> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.first_name && { first_name: data.first_name }),
        ...(data.last_name && { last_name: data.last_name }),
        ...(data.email && { email: data.email }),
        ...(data.avatar_url && { avatar_url: data.avatar_url }),
      },
      include: { wallet: true },
    });

    // Log profile update
    await this.activityLog.log(userId, 'PROFILE_UPDATED', {
      fields_updated: Object.keys(data),
    });

    return {
      id: user.id,
      phone: user.phone,
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      avatar_url: resolveUserAvatarUrl(user),
      squad_virtual_account: user.squad_virtual_account,
      squad_bank_code: user.squad_bank_code,
      kyc_verified: user.kyc_verified,
      wallet: {
        balance: user.wallet?.balance || 0n,
        currency: 'NGN',
      },
    };
  }

  /**
   * Get public profile (limited info - name, avatar only)
   * Never expose: phone, email, squad_virtual_account
   */
  async getPublicProfile(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      avatar_url: resolveUserAvatarUrl(user),
      // trust_tier would be fetched from Redis cache (populated by fraud service)
    };
  }
}

