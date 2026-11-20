import { HttpStatus, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { TrustService } from '../common/services/trust.service';
import { resolveUserAvatarUrl } from '../common/utils/avatar.util';
import { apiError } from '../common/errors/api-error';
import { ActivityLogService } from '../common/services/activity-log.service';
import { createHash } from 'crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DiscoveryKind = 'ble' | 'qr';

@Injectable()
export class DiscoverService {
  /** BLE tokens live ~3 minutes; the app rotates roughly every 120 s. */
  private readonly BLE_TTL = 180;
  /** QR tokens are server-chosen minutes; kept independent of the BLE token. */
  private readonly QR_TTL = 300;
  /** Remember tokens after expiry so we can answer 410 instead of 404. */
  private readonly SEEN_TTL = 86400;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trust: TrustService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Audit trail keeps a short hash, never the raw token. */
  private tokenRef(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 12);
  }

  // ── registration ────────────────────────────────────────────

  /**
   * POST /discover/broadcast — register a discovery token for the signed-in
   * user. The server issues the token when the body is empty (requirements Q5).
   */
  async registerToken(
    userId: string,
    token?: string,
    kind: DiscoveryKind = 'ble',
  ) {
    const value = (token ?? '').trim() || uuidv4();

    if (!UUID_RE.test(value)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TOKEN_MALFORMED',
        'Discovery tokens must be a well-formed UUID.',
        { field: 'token' },
      );
    }

    const existing = await this.redis.get<any>(`discover:${value}`);
    if (existing?.user_id && existing.user_id !== userId) {
      throw apiError(
        HttpStatus.CONFLICT,
        'TOKEN_IN_USE',
        'That discovery token is already registered to another account.',
      );
    }

    const ttl = kind === 'qr' ? this.QR_TTL : this.BLE_TTL;
    const record = { user_id: userId, kind };

    await this.redis.set(`discover:${value}`, record, ttl);
    await this.redis.set(`discover_seen:${value}`, record, this.SEEN_TTL);
    await this.redis.set(`discover_user:${kind}:${userId}`, value, ttl);

    await this.activityLog.log(userId, 'DISCOVER_REGISTER', {
      kind,
      token_ref: this.tokenRef(value),
      ttl,
    });

    return {
      token: value,
      ttl,
      expires_in: ttl,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /** DELETE /discover/broadcast — stop being discoverable, account-wide. */
  async removeTokensForUser(userId: string) {
    const keys: string[] = [];

    for (const kind of ['ble', 'qr'] as DiscoveryKind[]) {
      const userKey = `discover_user:${kind}:${userId}`;
      const token = await this.redis.get<string>(userKey);
      if (token) {
        keys.push(`discover:${token}`, userKey);
      }
    }

    if (keys.length > 0) {
      await this.redis.del(keys);
    }

    return { success: true };
  }

  // ── QR ──────────────────────────────────────────────────────

  /**
   * GET /discover/qr — short-lived QR payload. Issuing a QR does not touch the
   * live BLE token (requirements Q6).
   */
  async getQrToken(userId: string) {
    const existing = await this.redis.get<string>(`discover_user:qr:${userId}`);
    let token = existing;

    if (!token) {
      token = uuidv4();
      await this.redis.set(
        `discover:${token}`,
        { user_id: userId, kind: 'qr' },
        this.QR_TTL,
      );
      await this.redis.set(
        `discover_seen:${token}`,
        { user_id: userId, kind: 'qr' },
        this.SEEN_TTL,
      );
      await this.redis.set(`discover_user:qr:${userId}`, token, this.QR_TTL);
    }

    return {
      qr: `paydrop://discover?token=${token}`,
      token,
      ttl: this.QR_TTL,
      expires_in: this.QR_TTL,
      expires_at: new Date(Date.now() + this.QR_TTL * 1000).toISOString(),
    };
  }

  // ── resolution ──────────────────────────────────────────────

  /**
   * POST /discover/resolve — turn one token into the minimal public profile
   * the review card shows. Never returns phone, email, bank or balance.
   */
  async resolveToken(viewerUserId: string, token: string) {
    const value = (token ?? '').trim();

    if (!value) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'A discovery token is required.',
        { field: 'token' },
      );
    }

    const record = await this.redis.get<any>(`discover:${value}`);

    if (!record?.user_id) {
      const seen = await this.redis.get<any>(`discover_seen:${value}`);

      await this.activityLog.log(viewerUserId, 'DISCOVER_RESOLVE_MISS', {
        token_ref: this.tokenRef(value),
        result: seen ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      });

      if (seen) {
        throw apiError(
          HttpStatus.GONE,
          'TOKEN_EXPIRED',
          'That code has expired. Ask them to show a new one.',
        );
      }
      throw apiError(
        HttpStatus.NOT_FOUND,
        'TOKEN_INVALID',
        'Code not recognised.',
      );
    }

    const targetId = String(record.user_id);

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        avatar_url: true,
      },
    });

    if (!user) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'TOKEN_INVALID',
        'Code not recognised.',
      );
    }

    await this.activityLog.log(viewerUserId, 'DISCOVER_RESOLVE', {
      token_ref: this.tokenRef(value),
      result: 'RESOLVED',
      target_id: targetId,
    });

    const [relationship, trust, mutual] = await Promise.all([
      this.trust.relationship(viewerUserId, targetId),
      this.trust.forUser(targetId),
      this.trust.mutualTrust(viewerUserId, targetId),
    ]);

    return {
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name ?? null,
        username: user.username ?? null,
        avatar_url: resolveUserAvatarUrl(user),
        relationship,
        trust_score: trust.trust_score,
        trust_tier: trust.trust_tier,
        mutual_trust: mutual,
      },
    };
  }

  /** Batch resolve used by BLE scanning (a single miss never fails the batch). */
  async resolveTokens(viewerUserId: string, tokens: string[]) {
    const unique = Array.from(
      new Set((tokens ?? []).filter((t) => !!t && UUID_RE.test(t))),
    );

    const results = await Promise.all(
      unique.map(async (token) => {
        try {
          return {
            token,
            user: (await this.resolveToken(viewerUserId, token)).user,
          };
        } catch (error: any) {
          return {
            token,
            user: null,
            code: error?.response?.code ?? 'TOKEN_INVALID',
          };
        }
      }),
    );

    return {
      users: results.filter((r) => !!r.user).map((r) => r.user),
      unresolved: results
        .filter((r) => !r.user)
        .map((r) => ({ token: r.token, code: r.code })),
    };
  }
}
