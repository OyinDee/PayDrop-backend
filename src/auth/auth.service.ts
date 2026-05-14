import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { TermiiService } from '../common/services/termii.service';
import { JwtTokenService } from '../common/services/jwt-token.service';
import { RedisService } from '../common/services/redis.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { VerifyOtpDto, RefreshTokenDto, OtpIntent } from './dto/auth.dto';
import { normalizeNgPhone } from '../common/utils/phone.util';
import { buildDefaultAvatarUrl, resolveUserAvatarUrl } from '../common/utils/avatar.util';
// Use enum values as strings to avoid relying on generated prisma client exports

@Injectable()
export class AuthService {
  private readonly OTP_RATE_LIMIT = 3; // max requests per 10 minutes
  private readonly OTP_RATE_WINDOW = 600; // 10 minutes in seconds
  private readonly REFRESH_TOKEN_TTL = 604800; // 7 days in seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly termiiService: TermiiService,
    private readonly jwtService: JwtTokenService,
    private readonly redisService: RedisService,
    private readonly squadService: SquadService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Request OTP via Termii
   * Rate limited: 3 requests per phone per 10 minutes
   */
  async requestOtp(phone: string, intent: OtpIntent): Promise<any> {
    const normalizedPhone = normalizeNgPhone(phone);

    const existingUser = await (this.prisma as any).user.findUnique({
      where: { phone: normalizedPhone },
      select: { id: true },
    });

    if (intent === OtpIntent.LOGIN && !existingUser) {
      throw new BadRequestException(
        'No account for this phone number. Use signup to register.',
      );
    }

    if (intent === OtpIntent.SIGNUP && existingUser) {
      throw new BadRequestException(
        'This phone is already registered. Use login to sign in.',
      );
    }

    // Rate limit check
    const rateLimitKey = `otp_rate:${normalizedPhone}`;
    const attempts = await this.redisService.get<number>(rateLimitKey);

    if (attempts && attempts >= this.OTP_RATE_LIMIT) {
      throw new BadRequestException(
        'Too many OTP requests. Try again in 10 minutes.',
      );
    }

    try {
      // Send OTP via Termii
      await this.termiiService.sendOtp(normalizedPhone);

      // Increment rate limit counter
      if (attempts) {
        await this.redisService.set(
          rateLimitKey,
          attempts + 1,
          this.OTP_RATE_WINDOW,
        );
      } else {
        await this.redisService.set(
          rateLimitKey,
          1,
          this.OTP_RATE_WINDOW,
        );
      }

      return {
        success: true,
        message: 'OTP sent successfully',
        expires_in: 600, // 10 minutes
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException('Failed to send OTP: ' + message);
    }
  }

  /**
   * Verify OTP and create/update user
   * On first login: atomic transaction creates user + Squad VA + wallet
   */
  async verifyOtp(data: VerifyOtpDto): Promise<any> {
    const {
      intent,
      phone,
      otp,
      first_name,
      last_name,
      email,
      avatar_url,
      username,
      bvn,
      dob,
    } = data;
    const normalizedPhone = normalizeNgPhone(phone);

    // Verify OTP with Termii
    const otpVerification = await this.termiiService.verifyOtp(
      normalizedPhone,
      otp,
    );

    if (!otpVerification.verified) {
      const userForLog = await (this.prisma as any).user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
      });

      await this.activityLog.log(userForLog?.id, 'OTP_FAILED', {
        reason: 'Invalid OTP',
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    // Check if user exists
    const existingUser = await (this.prisma as any).user.findUnique({
      where: { phone: normalizedPhone },
      include: { wallet: true },
    });

    if (intent === OtpIntent.LOGIN) {
      if (!existingUser) {
        throw new NotFoundException(
          'No account for this phone number. Sign up first.',
        );
      }

      const accessToken = this.jwtService.generateAccessToken(
        existingUser.id,
        existingUser.phone,
      );
      const refreshToken = uuidv4();
      await this.redisService.set(
        `refresh:${refreshToken}`,
        existingUser.id,
        this.REFRESH_TOKEN_TTL,
      );

      await this.activityLog.log(existingUser.id, 'LOGIN_SUCCESS');

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: this.formatUserResponse(existingUser),
        wallet: {
          balance: existingUser.wallet?.balance || 0n,
          currency: 'NGN',
        },
      };
    }

    // SIGNUP
    if (existingUser) {
      throw new ConflictException(
        'This phone is already registered. Log in instead.',
      );
    }

    if (!first_name || !last_name || !bvn || !dob || !username) {
      throw new BadRequestException(
        'first_name, last_name, username, bvn, and dob are required for signup',
      );
    }

    const normalizedUsername = username.trim().toLowerCase();
    const usernameTaken = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true },
    });
    if (usernameTaken) {
      throw new ConflictException('Username is already taken');
    }

    const storedAvatarUrl =
      avatar_url?.trim() || buildDefaultAvatarUrl(normalizedUsername);

    // First-time registration — atomic transaction
    try {
      const user = await (this.prisma as any).$transaction(async (tx: any) => {
        // 1. Create user
        const newUser = await tx.user.create({
          data: {
            phone: normalizedPhone,
            username: normalizedUsername,
            first_name,
            last_name,
            email: email || null,
            avatar_url: storedAvatarUrl,
          },
        });

        // 2. Create Squad VA (Squad validates BVN vs name, DOB, phone — no separate BVN-only API in docs)
        const squadAccount = await this.squadService.createVirtualAccount(
          newUser.id,
          first_name,
          last_name,
          normalizedPhone,
          email,
          { bvn, dob },
        );

        // 3. Update user with Squad details
        const updatedUser = await tx.user.update({
          where: { id: newUser.id },
          data: {
            squad_virtual_account: squadAccount.virtual_account_number,
            squad_bank_code: squadAccount.bank_code,
            kyc_verified: true,
          },
          include: { wallet: true },
        });

        // 4. Create wallet
        const wallet = await tx.wallet.create({
          data: {
            user_id: updatedUser.id,
            balance: 0n,
            currency: 'NGN',
          },
        });

        updatedUser.wallet = wallet;
        return updatedUser;
      });

      // Log successful login
      await this.activityLog.log(user.id, 'LOGIN_SUCCESS', {
        squad_virtual_account: user.squad_virtual_account,
      });
      await this.activityLog.log(user.id, 'KYC_BVN_VERIFIED', {
        source: 'signup_virtual_account',
      });

      // Generate tokens
      const accessToken = this.jwtService.generateAccessToken(
        user.id,
        user.phone,
      );
      const refreshToken = uuidv4();
      await this.redisService.set(
        `refresh:${refreshToken}`,
        user.id,
        this.REFRESH_TOKEN_TTL,
      );

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: this.formatUserResponse(user),
        wallet: {
          balance: user.wallet?.balance || 0n,
          currency: 'NGN',
        },
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const target = error?.meta?.target;
        const targets = Array.isArray(target) ? target : target ? [target] : [];
        if (targets.includes('username')) {
          throw new ConflictException('Username is already taken');
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(
        'Signup failed: ' + message,
      );
    }
  }

  /**
   * Refresh access token
   * Token rotation: old refresh token invalidated immediately
   */
  async refreshAccessToken(data: RefreshTokenDto): Promise<any> {
    const { refresh_token } = data;

    // Get user ID from Redis
    const userId = await this.redisService.get<string>(`refresh:${refresh_token}`);

    if (!userId) {
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
      );
    }

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Invalidate old token immediately
    await this.redisService.del(`refresh:${refresh_token}`);

    // Issue new tokens
    const newAccessToken = this.jwtService.generateAccessToken(
      user.id,
      user.phone,
    );
    const newRefreshToken = uuidv4();
    await this.redisService.set(
      `refresh:${newRefreshToken}`,
      user.id,
      this.REFRESH_TOKEN_TTL,
    );

    // Log token refresh
    await this.activityLog.log(user.id, 'TOKEN_REFRESHED');

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Logout - delete refresh token from Redis
   */
  async logout(refreshToken: string): Promise<any> {
    const userId = await this.redisService.get<string>(`refresh:${refreshToken}`);

    if (userId) {
      await this.redisService.del(`refresh:${refreshToken}`);
      await this.activityLog.log(userId, 'LOGOUT');
    }

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  /**
   * Format user response (no sensitive data)
   */
  private formatUserResponse(user: any): any {
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
    };
  }
}
