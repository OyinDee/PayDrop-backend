import {
  Injectable,
  HttpStatus,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { TermiiService } from '../common/services/termii.service';
import { JwtTokenService } from '../common/services/jwt-token.service';
import { RedisService } from '../common/services/redis.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { TrustService } from '../common/services/trust.service';
import { VerifyOtpDto, RefreshTokenDto, OtpIntent } from './dto/auth.dto';
import {
  normalizeNgPhone,
  toE164,
  isValidNgPhone,
} from '../common/utils/phone.util';
import {
  buildDefaultAvatarUrl,
  resolveUserAvatarUrl,
} from '../common/utils/avatar.util';
import {
  isTestAuthEnabled,
  resolveTestAccount,
  TEST_ACCOUNTS,
  TEST_AUTH_OTP,
} from '../common/constants/test-auth.constants';
import { apiError } from '../common/errors/api-error';
import { enforceRateLimit } from '../common/utils/rate-limit.util';

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[A-Za-z][A-Za-z\s'-]{0,49}$/;

/** Handles we never hand out to users. */
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'paydrop',
  'support',
  'help',
  'api',
  'root',
  'system',
  'official',
  'security',
  'billing',
  'wallet',
  'settings',
  'me',
  'users',
  'auth',
]);

@Injectable()
export class AuthService {
  /** 5 OTP requests per phone per hour (requirements 3.5). */
  private readonly OTP_HOURLY_LIMIT = 5;
  private readonly OTP_RATE_WINDOW = 3600;
  /** 60 s server-enforced resend cooldown. */
  private readonly OTP_RESEND_COOLDOWN = 60;
  private readonly OTP_MAX_ATTEMPTS = 5;
  /** Rotating refresh token: 30 days (requirements 3.4). */
  private readonly REFRESH_TOKEN_TTL = 2592000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly termiiService: TermiiService,
    private readonly jwtService: JwtTokenService,
    private readonly redisService: RedisService,
    private readonly activityLog: ActivityLogService,
    private readonly trustService: TrustService,
  ) {}

  /** Access token lifetime in seconds, derived from JWT_ACCESS_EXPIRY. */
  private get accessTokenTtlSeconds(): number {
    const raw = process.env.JWT_ACCESS_EXPIRY || '15m';
    const match = /^(\d+)([smhd])?$/.exec(raw.trim());
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2] || 's';
    const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
    return value * multiplier;
  }

  // ── availability ─────────────────────────────────────────────

  /**
   * POST /auth/check-availability — fail the Register form before an OTP is
   * burned. Never reveals more than available | taken | invalid.
   */
  async checkAvailability(input: {
    phone?: string;
    email?: string;
    username?: string;
  }) {
    if (!input.phone && !input.email && !input.username) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Provide at least one of phone, email or username.',
        { field: 'phone' },
      );
    }

    const result: { phone?: string; email?: string; username?: string } = {};

    if (input.phone !== undefined) {
      result.phone = !isValidNgPhone(input.phone)
        ? 'invalid'
        : (await this.prisma.user.findUnique({
            where: { phone: normalizeNgPhone(input.phone) },
            select: { id: true },
          }))
          ? 'taken'
          : 'available';
    }

    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      result.email = !EMAIL_RE.test(email)
        ? 'invalid'
        : (await this.prisma.user.findUnique({
            where: { email },
            select: { id: true },
          }))
          ? 'taken'
          : 'available';
    }

    if (input.username !== undefined) {
      const username = input.username.trim().toLowerCase();
      result.username =
        !USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)
          ? 'invalid'
          : (await this.prisma.user.findUnique({
              where: { username },
              select: { id: true },
            }))
            ? 'taken'
            : 'available';
    }

    return result;
  }

  // ── OTP ──────────────────────────────────────────────────────

  async requestOtp(phone: string, intent?: OtpIntent) {
    if (!isValidNgPhone(phone)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid Nigerian mobile number.',
        { field: 'phone' },
      );
    }

    const normalizedPhone = normalizeNgPhone(phone);

    const existingUser = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      select: { id: true },
    });

    // Intent is optional: a client that just posts a number gets the flow that
    // matches the account (existing -> login, new -> signup).
    const resolvedIntent: OtpIntent =
      intent ?? (existingUser ? OtpIntent.LOGIN : OtpIntent.SIGNUP);

    if (resolvedIntent === OtpIntent.LOGIN && !existingUser) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'ACCOUNT_NOT_FOUND',
        'No PayDrop account uses this number. Create one instead.',
        { phone: toE164(normalizedPhone) },
      );
    }

    if (resolvedIntent === OtpIntent.SIGNUP && existingUser) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ACCOUNT_EXISTS',
        'This number already has an account. Log in instead.',
        { phone: toE164(normalizedPhone) },
      );
    }

    // Server-enforced resend cooldown.
    const cooldownKey = `otp_cooldown:${normalizedPhone}`;
    const cooldown = await this.redisService.ttl(cooldownKey);
    if (!isTestAuthEnabled() && cooldown > 0) {
      throw apiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        `Wait ${cooldown}s before requesting another code.`,
        { retry_after: cooldown },
      );
    }

    if (!isTestAuthEnabled()) {
      await enforceRateLimit(this.redisService, {
        key: `otp_rate:${normalizedPhone}`,
        limit: this.OTP_HOURLY_LIMIT,
        windowSeconds: this.OTP_RATE_WINDOW,
        message: 'Too many codes requested for this number. Try again later.',
      });
    }

    try {
      await this.termiiService.sendOtp(normalizedPhone, resolvedIntent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw apiError(
        HttpStatus.BAD_GATEWAY,
        'SERVICE_UNAVAILABLE',
        'Could not send the code right now. Please try again.',
        { provider_message: message },
      );
    }

    await this.redisService.set(
      cooldownKey,
      1,
      this.OTP_RESEND_COOLDOWN,
    );

    return {
      success: true,
      message: 'OTP sent successfully',
      intent: resolvedIntent,
      expires_in: this.termiiService.ttlSeconds,
      resend_after: this.OTP_RESEND_COOLDOWN,
    };
  }

  // ── verify / signup ──────────────────────────────────────────

  async verifyOtp(data: VerifyOtpDto, deviceId?: string) {
    const { phone, otp, first_name, last_name, email, avatar_url } = data;

    if (!isValidNgPhone(phone)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid Nigerian mobile number.',
        { field: 'phone' },
      );
    }

    const normalizedPhone = normalizeNgPhone(phone);

    // The intent is optional here too: default to the flow that fits the
    // account so a client can verify with just { phone, otp }.
    const phoneOwner = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      include: { wallet: true },
    });
    const intent: OtpIntent =
      data.intent ?? (phoneOwner ? OtpIntent.LOGIN : OtpIntent.SIGNUP);

    const attemptKey = `otp_attempts:${intent}:${normalizedPhone}`;

    // Brute-force guard. Skipped in test mode so local flows stay usable.
    if (!isTestAuthEnabled()) {
      const failedAttempts = Number(
        (await this.redisService.get<number>(attemptKey)) ?? 0,
      );
      if (failedAttempts >= this.OTP_MAX_ATTEMPTS) {
        throw apiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_ATTEMPTS_EXCEEDED',
          'Too many invalid attempts on this code. Request a new one.',
          { attempts_left: 0 },
        );
      }
    }

    // Signup-only validation happens BEFORE the code is consumed, so a taken
    // username or email does not burn the OTP (requirements 3.3).
    let normalizedUsername: string | null = null;
    let normalizedEmail: string | null = null;

    if (intent === OtpIntent.SIGNUP) {
      const firstName = (first_name ?? '').trim();
      const lastName = (last_name ?? '').trim();
      const missing = [
        !firstName && 'first_name',
        !lastName && 'last_name',
        !(data.username ?? '').trim() && 'username',
      ].filter(Boolean);

      if (missing.length > 0) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          `Missing required field(s) for signup: ${missing.join(', ')}.`,
          { fields: missing },
        );
      }

      if (!NAME_RE.test(firstName)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'first_name must be 1-50 letters, spaces, hyphens or apostrophes.',
          { field: 'first_name' },
        );
      }
      if (!NAME_RE.test(lastName)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'last_name must be 1-50 letters, spaces, hyphens or apostrophes.',
          { field: 'last_name' },
        );
      }

      normalizedUsername = (data.username ?? '').trim().toLowerCase();
      if (
        !USERNAME_RE.test(normalizedUsername) ||
        RESERVED_USERNAMES.has(normalizedUsername)
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'username must be 3-20 characters: letters, numbers, underscore or dot.',
          { field: 'username' },
        );
      }

      if (email) {
        normalizedEmail = email.trim().toLowerCase();
        if (!EMAIL_RE.test(normalizedEmail)) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            'Enter a valid email address.',
            { field: 'email' },
          );
        }
      }

      const [usernameOwner, emailOwner] = await Promise.all([
        this.prisma.user.findUnique({
          where: { username: normalizedUsername },
          select: { id: true },
        }),
        normalizedEmail
          ? this.prisma.user.findUnique({
              where: { email: normalizedEmail },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

      if (usernameOwner) {
        throw apiError(
          HttpStatus.CONFLICT,
          'USERNAME_TAKEN',
          'That username is already taken.',
          { field: 'username' },
        );
      }
      if (emailOwner) {
        throw apiError(
          HttpStatus.CONFLICT,
          'EMAIL_TAKEN',
          'That email is already registered.',
          { field: 'email' },
        );
      }
    }

    const otpVerification = await this.termiiService.verifyOtp(
      normalizedPhone,
      otp,
      intent,
    );

    if (!otpVerification.verified) {
      if (otpVerification.expired) {
        throw apiError(
          HttpStatus.GONE,
          'OTP_EXPIRED',
          otpVerification.message,
        );
      }

      const attempts = await this.redisService.incr(attemptKey);
      await this.redisService.expire(attemptKey, 600);

      const attemptsLeft = Math.max(0, this.OTP_MAX_ATTEMPTS - Number(attempts));

      await this.activityLog.log(null, 'OTP_FAILED', {
        reason: 'Invalid OTP',
        intent,
        attempt: Number(attempts),
      });

      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'OTP_INVALID',
        `That code is not correct. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`,
        { attempts_left: attemptsLeft },
      );
    }

    await this.redisService.del(attemptKey);

    const existingUser = phoneOwner;

    if (intent === OtpIntent.LOGIN) {
      if (!existingUser) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ACCOUNT_NOT_FOUND',
          'No PayDrop account uses this number. Create one instead.',
        );
      }

      if (!existingUser.avatar_url?.trim()) {
        const defaultAvatar = buildDefaultAvatarUrl(
          existingUser.username || existingUser.id,
        );
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { avatar_url: defaultAvatar },
        });
        existingUser.avatar_url = defaultAvatar;
      }

      const session = await this.issueSession(
        existingUser.id,
        existingUser.phone,
        deviceId,
      );

      await this.activityLog.log(existingUser.id, 'LOGIN_SUCCESS');

      return {
        ...session,
        user: await this.buildUserDto(existingUser),
        wallet: this.walletDto(existingUser.wallet),
      };
    }

    // SIGNUP
    if (existingUser) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ACCOUNT_EXISTS',
        'This number already has an account. Log in instead.',
      );
    }

    const storedAvatarUrl =
      avatar_url?.trim() || buildDefaultAvatarUrl(normalizedUsername ?? '');

    try {
      const user = await this.prisma.$transaction<any>(async (tx: any) => {
        const newUser = await tx.user.create({
          data: {
            phone: normalizedPhone,
            username: normalizedUsername,
            first_name: first_name!.trim(),
            last_name: last_name!.trim(),
            email: normalizedEmail,
            avatar_url: storedAvatarUrl,
            kyc_verified: false,
            kyc_status: 'NOT_STARTED',
            kyc_tier: 0,
          },
        });

        // The wallet exists from the first second of the account; the Squad
        // virtual account is provisioned later, when KYC is completed.
        const wallet = await tx.wallet.create({
          data: {
            user_id: newUser.id,
            balance: 0n,
            currency: 'NGN',
          },
        });

        newUser.wallet = wallet;
        return newUser;
      });

      await this.activityLog.log(user.id, 'ACCOUNT_CREATED', {
        intent,
        kyc_status: 'NOT_STARTED',
      });

      const session = await this.issueSession(
        user.id,
        user.phone,
        deviceId,
      );

      return {
        ...session,
        user: await this.buildUserDto(user),
        wallet: this.walletDto(user.wallet),
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const target = error?.meta?.target;
        const targets = Array.isArray(target) ? target : target ? [target] : [];
        if (targets.includes('username')) {
          throw apiError(
            HttpStatus.CONFLICT,
            'USERNAME_TAKEN',
            'That username is already taken.',
            { field: 'username' },
          );
        }
        if (targets.includes('email')) {
          throw apiError(
            HttpStatus.CONFLICT,
            'EMAIL_TAKEN',
            'That email is already registered.',
            { field: 'email' },
          );
        }
        if (targets.includes('phone')) {
          throw apiError(
            HttpStatus.CONFLICT,
            'ACCOUNT_EXISTS',
            'This number already has an account. Log in instead.',
            { field: 'phone' },
          );
        }
      }
      if (error?.status) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw apiError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        'Could not create the account. Please try again.',
        { cause: message },
      );
    }
  }

  // ── test accounts ────────────────────────────────────────────

  /**
   * TEST ONLY - sign in as one of the preset accounts, no OTP.
   * Disabled unless test auth is on.
   */
  async testLogin(account?: string, deviceId?: string) {
    if (!isTestAuthEnabled()) {
      // 404 rather than 403 so the route is not advertised on real deployments.
      throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    }

    const preset = resolveTestAccount(account);
    if (!preset) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Unknown test account. Use 1, 2, 3, a phone number, or a username from GET /auth/test-accounts.',
        { field: 'account' },
      );
    }

    const normalizedPhone = normalizeNgPhone(preset.phone);

    let user = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      include: { wallet: true },
    });

    // Rows created before phone normalization stored the raw preset phone.
    if (!user && preset.phone !== normalizedPhone) {
      const legacyUser = await this.prisma.user.findUnique({
        where: { phone: preset.phone },
        include: { wallet: true },
      });
      if (legacyUser) {
        try {
          user = await this.prisma.user.update({
            where: { id: legacyUser.id },
            data: { phone: normalizedPhone },
            include: { wallet: true },
          });
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
          user = legacyUser;
        }
      }
    }

    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            phone: normalizedPhone,
            username: preset.username,
            first_name: preset.first_name,
            last_name: preset.last_name,
            email: preset.email,
            avatar_url: buildDefaultAvatarUrl(preset.username),
            kyc_verified: false,
            kyc_status: 'NOT_STARTED',
            kyc_tier: 0,
          },
          include: { wallet: true },
        });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        user = await this.prisma.user.findFirst({
          where: {
            OR: [{ phone: normalizedPhone }, { username: preset.username }],
          },
          include: { wallet: true },
        });
        if (!user) {
          throw apiError(
            HttpStatus.CONFLICT,
            'CONFLICT',
            'Could not provision test account.',
          );
        }
      }
    }

    if (!user.wallet) {
      const wallet = await this.prisma.wallet.create({
        data: { user_id: user.id, balance: 0n, currency: 'NGN' },
      });
      user.wallet = wallet;
    }

    const session = await this.issueSession(user.id, user.phone, deviceId);

    await this.activityLog.log(user.id, 'LOGIN_SUCCESS', {
      test_mode: true,
      test_account: preset.index,
    });

    return {
      ...session,
      user: await this.buildUserDto(user),
      wallet: this.walletDto(user.wallet),
    };
  }

  listTestAccounts() {
    if (!isTestAuthEnabled()) {
      throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    }
    return {
      test_mode: true,
      otp: TEST_AUTH_OTP,
      accounts: TEST_ACCOUNTS,
    };
  }

  // ── sessions ─────────────────────────────────────────────────

  /**
   * Rotate the token pair. Replaying an already-rotated token revokes the whole
   * session family (requirements 3.4 / 7.2).
   */
  async refreshAccessToken(data: RefreshTokenDto, deviceId?: string) {
    const refreshToken = (data.refreshToken ?? data.refresh_token ?? '').trim();

    if (!refreshToken) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'refreshToken is required.',
        { field: 'refreshToken' },
      );
    }

    const stored = await this.redisService.get<any>(`refresh:${refreshToken}`);

    if (!stored) {
      const used = await this.redisService.get<any>(
        `refresh_used:${refreshToken}`,
      );
      if (used?.family) {
        await this.revokeFamily(used.family);
        await this.activityLog.log(used.user_id, 'REFRESH_REUSE_DETECTED', {
          family: used.family,
        });
      }
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'REFRESH_INVALID',
        'Please log in again.',
      );
    }

    const userId = String(stored.user_id ?? stored);
    const sessionDid: string | null = stored.did ?? null;
    const family: string = stored.family ?? uuidv4();

    if (deviceId && sessionDid && String(sessionDid) !== String(deviceId)) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'REFRESH_INVALID',
        'Please log in again.',
        { reason: 'device_mismatch' },
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'REFRESH_INVALID',
        'Please log in again.',
      );
    }

    // Old token dies now; a replay of it hits the used-marker above.
    await this.redisService.del(`refresh:${refreshToken}`);
    await this.redisService.set(
      `refresh_used:${refreshToken}`,
      { family, user_id: userId },
      this.REFRESH_TOKEN_TTL,
    );

    await this.activityLog.log(user.id, 'TOKEN_REFRESHED');

    return this.issueSession(user.id, user.phone, sessionDid || deviceId, family);
  }

  /** Idempotent: revokes the presented refresh token if it exists. */
  async logout(refreshToken?: string) {
    const token = (refreshToken ?? '').trim();
    if (!token) return;

    const stored = await this.redisService.get<any>(`refresh:${token}`);
    if (stored) {
      const userId = String(stored.user_id ?? stored);
      await this.redisService.del(`refresh:${token}`);
      await this.activityLog.log(userId, 'LOGOUT');
    }
  }

  private async issueSession(
    userId: string,
    phone: string,
    deviceId?: string,
    family?: string,
  ) {
    const refreshToken = uuidv4();
    const sessionFamily = family ?? uuidv4();

    await this.redisService.set(
      `refresh:${refreshToken}`,
      { user_id: userId, did: deviceId || null, family: sessionFamily },
      this.REFRESH_TOKEN_TTL,
    );

    const familyKey = `refresh_family:${sessionFamily}`;
    const members =
      (await this.redisService.get<string[]>(familyKey)) ?? [];
    members.push(refreshToken);
    await this.redisService.set(familyKey, members, this.REFRESH_TOKEN_TTL);

    return {
      accessToken: this.jwtService.generateAccessToken(
        userId,
        phone,
        deviceId,
      ),
      refreshToken,
      expiresIn: this.accessTokenTtlSeconds,
    };
  }

  private async revokeFamily(family: string) {
    const familyKey = `refresh_family:${family}`;
    const members = (await this.redisService.get<string[]>(familyKey)) ?? [];

    for (const token of members) {
      await this.redisService.del(`refresh:${token}`);
    }
    await this.redisService.del(familyKey);
  }

  // ── response shaping ─────────────────────────────────────────

  private walletDto(wallet: any) {
    return {
      balance: Number(wallet?.balance ?? 0),
      currency: wallet?.currency ?? 'NGN',
    };
  }

  private async buildUserDto(user: any) {
    const trust = await this.trustService.forUser(user.id);

    return {
      id: user.id,
      phone: toE164(user.phone),
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email ?? null,
      avatar_url: resolveUserAvatarUrl(user),
      kyc_status:
        user.kyc_status ?? (user.kyc_verified ? 'VERIFIED' : 'NOT_STARTED'),
      kyc_verified: !!user.kyc_verified,
      tier: Number(user.kyc_tier ?? (user.kyc_verified ? 1 : 0)),
      trust_score: trust.trust_score,
      trust_tier: trust.trust_tier,
      squad_virtual_account: user.squad_virtual_account ?? null,
      squad_bank_code: user.squad_bank_code ?? null,
    };
  }
}
