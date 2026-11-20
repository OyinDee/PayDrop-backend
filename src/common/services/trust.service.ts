import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type TrustTier = 'LOW' | 'MEDIUM' | 'TRUSTED';

export interface TrustProfile {
  trust_score: number;
  trust_tier: TrustTier;
}

export type Relationship =
  | 'PAID_BEFORE'
  | 'CONTACT_PAID'
  | 'NO_PRIOR_RELATIONSHIP';

/**
 * Server-owned trust. The app never computes this itself (requirements Q11),
 * so the score is derived here from facts we already store: KYC state, account
 * age and how much successful payment history the user has.
 */
@Injectable()
export class TrustService {
  constructor(private readonly prisma: PrismaService) {}

  private profileFor(input: {
    kycVerified: boolean;
    completedCount: number;
    createdAt?: Date | null;
  }): TrustProfile {
    let score = 50;

    if (input.kycVerified) score += 20;

    score += Math.min(20, input.completedCount * 2);

    if (input.createdAt) {
      const ageDays =
        (Date.now() - new Date(input.createdAt).getTime()) / 86_400_000;
      if (ageDays >= 30) score += 10;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    const trust_tier: TrustTier =
      score >= 80 ? 'TRUSTED' : score >= 55 ? 'MEDIUM' : 'LOW';

    return { trust_score: score, trust_tier };
  }

  async completedTransfers(userId: string): Promise<number> {
    return this.prisma.transaction.count({
      where: {
        status: 'COMPLETED',
        OR: [{ sender_id: userId }, { recipient_id: userId }],
      },
    });
  }

  async forUser(userId: string): Promise<TrustProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kyc_verified: true, created_at: true },
    });

    if (!user) {
      return this.profileFor({ kycVerified: false, completedCount: 0 });
    }

    const completedCount = await this.completedTransfers(userId);

    return this.profileFor({
      kycVerified: !!user.kyc_verified,
      completedCount,
      createdAt: user.created_at,
    });
  }

  async forUsers(userIds: string[]): Promise<Map<string, TrustProfile>> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    const entries = await Promise.all(
      unique.map(async (id) => [id, await this.forUser(id)] as const),
    );
    return new Map(entries);
  }

  /** How the viewer and the target already know each other. */
  async relationship(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<Relationship> {
    if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) {
      return 'NO_PRIOR_RELATIONSHIP';
    }

    const prior = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { sender_id: viewerUserId, recipient_id: targetUserId },
          { sender_id: targetUserId, recipient_id: viewerUserId },
        ],
        status: 'COMPLETED',
      },
      select: { id: true },
    });

    return prior ? 'PAID_BEFORE' : 'NO_PRIOR_RELATIONSHIP';
  }

  /**
   * Mutual counterparties between two users. Returns a short human string the
   * review card can show, or null when there are none.
   */
  async mutualTrust(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<string | null> {
    if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) {
      return null;
    }

    const [viewerParties, targetParties] = await Promise.all([
      this.counterparties(viewerUserId),
      this.counterparties(targetUserId),
    ]);

    const mutual = targetParties.filter(
      (id) => viewerParties.includes(id) && id !== viewerUserId && id !== targetUserId,
    );

    if (mutual.length === 0) return null;
    return `${mutual.length} mutual contact${mutual.length === 1 ? '' : 's'}`;
  }

  private async counterparties(userId: string): Promise<string[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ sender_id: userId }, { recipient_id: userId }],
      },
      select: { sender_id: true, recipient_id: true },
      take: 500,
      orderBy: { created_at: 'desc' },
    });

    return rows
      .map((row: any) =>
        row.sender_id === userId ? row.recipient_id : row.sender_id,
      )
      .filter((id: string | null): id is string => !!id);
  }
}
