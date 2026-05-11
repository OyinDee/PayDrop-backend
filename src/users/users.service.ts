import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
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
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      avatar_url: user.avatar_url,
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
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      avatar_url: user.avatar_url,
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
      first_name: user.first_name,
      last_name: user.last_name,
      avatar_url: user.avatar_url,
      // trust_tier would be fetched from Redis cache (populated by fraud service)
    };
  }
}

