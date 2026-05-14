import { Injectable, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { resolveUserAvatarUrl } from '../common/utils/avatar.util';

@Injectable()
export class DiscoverService {
  private readonly BLE_TTL = 180;
  private readonly BLE_KEY_PREFIX = 'ble:';
  private readonly BLE_USER_KEY_PREFIX = 'ble_user:';
  private readonly TRUST_KEY_PREFIX = 'trust:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async registerToken(userId: string, token: string) {
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('Token cannot be empty');
    }

    // Contract keys:
    // ble:{token} -> userId (TTL 180s)
    // ble_user:{userId} -> token (TTL 180s)
    await this.redis.set(`${this.BLE_KEY_PREFIX}${token}`, userId, this.BLE_TTL);
    await this.redis.set(`${this.BLE_USER_KEY_PREFIX}${userId}`, token, this.BLE_TTL);

    return {
      success: true,
      expires_in: this.BLE_TTL,
    };
  }

  async resolveTokens(requesterUserId: string, tokens: string[]) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return { users: [] };
    }

    const keys = tokens.map((t) => `${this.BLE_KEY_PREFIX}${t}`);
    const resolved = await this.redis.mget<string>(keys);
    const userIds = resolved.filter((id): id is string => Boolean(id));

    // Filter out requester (contract requirement)
    const filteredUserIds = userIds.filter((id) => id !== requesterUserId);

    if (filteredUserIds.length === 0) {
      return { users: [] };
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: filteredUserIds,
        },
      },
      select: {
        id: true,
        username: true,
        first_name: true,
        last_name: true,
        avatar_url: true,
      },
    });

    const trustKeys = users.map((u: { id: string }) => `${this.TRUST_KEY_PREFIX}${u.id}`);
    const trustValues = await this.redis.mget<string>(trustKeys);

    return {
      users: users.map((u: { id: string; username: string | null; first_name: string; last_name: string; avatar_url: string | null }, idx: number) => ({
        id: u.id,
        username: u.username ?? null,
        first_name: u.first_name,
        last_name: u.last_name,
        avatar_url: resolveUserAvatarUrl(u),
        trust_tier: trustValues[idx] || 'MEDIUM',
      })),
    };
  }

  async getQrToken(userId: string) {
    // Return existing token if still valid, else generate a new one.
    let token = await this.redis.get<string>(`${this.BLE_USER_KEY_PREFIX}${userId}`);
    if (!token) {
      token = uuidv4();
      await this.redis.set(`${this.BLE_KEY_PREFIX}${token}`, userId, this.BLE_TTL);
      await this.redis.set(`${this.BLE_USER_KEY_PREFIX}${userId}`, token, this.BLE_TTL);
    }

    return {
      token,
      qr_payload: Buffer.from(token).toString('base64'),
    };
  }

  async resolveQrToken(token: string) {
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('Token cannot be empty');
    }

    const userId = await this.redis.get<string>(`${this.BLE_KEY_PREFIX}${token}`);

    if (!userId) {
      throw new BadRequestException('Token expired or invalid');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        first_name: true,
        last_name: true,
        avatar_url: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const trustTier =
      (await this.redis.get<string>(`${this.TRUST_KEY_PREFIX}${user.id}`)) || 'MEDIUM';

    return {
      user: {
        id: user.id,
        username: user.username ?? null,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: resolveUserAvatarUrl(user),
        trust_tier: trustTier,
      },
    };
  }

  async removeTokenForUser(userId: string) {
    const token = await this.redis.get<string>(`${this.BLE_USER_KEY_PREFIX}${userId}`);
    if (!token) {
      return { success: true };
    }

    await this.redis.del([
      `${this.BLE_KEY_PREFIX}${token}`,
      `${this.BLE_USER_KEY_PREFIX}${userId}`,
    ]);

    return {
      success: true,
    };
  }
}
