import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsUrl,
  IsEnum,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';

/** Must match request-otp intent: login only if user exists; signup only if user does not exist. */
export enum OtpIntent {
  LOGIN = 'login',
  SIGNUP = 'signup',
}

const lower = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Pre-check identifiers before an OTP is sent. Fields are intentionally
 * loosely typed: a malformed value answers "invalid" rather than failing the
 * whole request, so the Register screen can mark that one input.
 */
export class CheckAvailabilityDto {
  @ApiProperty({
    description: 'Nigerian phone number to check (08123456789 or +2348123456789)',
    example: '08123456789',
    required: false,
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'Email address to check',
    example: 'ada@example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(lower)
  email?: string;

  @ApiProperty({
    description: 'Username to check (case-insensitive)',
    example: 'ada_o',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(lower)
  username?: string;
}

export class RequestOtpDto {
  @ApiProperty({
    description:
      'Optional. login: OTP for existing users only. signup: OTP for new registration only (phone must not already be registered). Omit it and the server infers the flow from whether the number has an account.',
    enum: OtpIntent,
    example: OtpIntent.LOGIN,
    required: false,
  })
  @IsOptional()
  @IsEnum(OtpIntent)
  intent?: OtpIntent;

  @ApiProperty({
    description: 'Nigerian phone number (e.g. 08012345678 or +2348012345678)',
    example: '08012345678',
  })
  @IsString()
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    description:
      'Optional; when omitted it is inferred from whether the number already has an account. signup creates the account with phone, name, username and optional email. No BVN or date of birth is required.',
    enum: OtpIntent,
    example: OtpIntent.LOGIN,
    required: false,
  })
  @IsOptional()
  @IsEnum(OtpIntent)
  intent?: OtpIntent;

  @ApiProperty({
    description: 'Nigerian phone number',
    example: '08012345678',
  })
  @IsString()
  phone: string;

  @ApiProperty({
    description: '6-digit OTP code',
    example: '482913',
  })
  @IsString()
  otp: string;

  @ApiProperty({
    description: 'First name (required for signup only)',
    example: 'Ada',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'first_name is required for signup' })
  @IsString()
  first_name?: string;

  @ApiProperty({
    description: 'Last name (required for signup only)',
    example: 'Obi',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'last_name is required for signup' })
  @IsString()
  last_name?: string;

  @ApiProperty({
    description:
      'Unique handle, stored lowercase (required for signup). 3–20 characters: a-z, 0-9, underscore, dot.',
    example: 'ada_o',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'username is required for signup' })
  @IsString()
  username?: string;

  @ApiProperty({
    description:
      'Email address (optional; validated server-side and unique when present)',
    example: 'ada@example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(lower)
  email?: string;

  @ApiProperty({
    description: 'Avatar URL (optional on signup; a default image is generated when omitted)',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  avatar_url?: string;

  // KYC is no longer collected at signup. Accepted for older app builds and ignored.
  @ApiProperty({ description: 'Deprecated: ignored at signup', required: false })
  @IsOptional()
  @IsString()
  bvn?: string;

  @ApiProperty({ description: 'Deprecated: ignored at signup', required: false })
  @IsOptional()
  @IsString()
  dob?: string;
}

export class TestLoginDto {
  @ApiProperty({
    description:
      'Test account selector: 1, 2, or 3, a test phone number, or a test username. Defaults to 1.',
    example: '1',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value)))
  @IsString()
  account?: string;
}

/**
 * Refresh/logout accept both spellings while older builds migrate:
 * the app sends refreshToken; refresh_token stays supported.
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token from previous login',
    example: 'rt_...',
    required: false,
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiProperty({
    description: 'Alias for refreshToken (legacy builds)',
    required: false,
  })
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

export class WalletDataDto {
  @ApiProperty({ description: 'Current balance in kobo', example: 50000 })
  balance: number;

  @ApiProperty({ description: 'Currency code', example: 'NGN' })
  currency: string;
}

export class UserDataDto {
  @ApiProperty({ description: 'User ID', example: 'usr_01J...' })
  id: string;

  @ApiProperty({ description: 'Phone number in E.164', example: '+2348123456789' })
  phone: string;

  @ApiProperty({
    description: 'Public username (null for legacy accounts)',
    example: 'ada_o',
    nullable: true,
  })
  username: string | null;

  @ApiProperty({ description: 'First name', example: 'Ada' })
  first_name: string;

  @ApiProperty({ description: 'Last name', example: 'Obi' })
  last_name: string;

  @ApiProperty({
    description: 'Email address',
    example: 'ada@example.com',
    nullable: true,
  })
  email: string | null;

  @ApiProperty({
    description: 'Resolved avatar URL (custom or generated)',
    example: 'https://api.dicebear.com/7.x/initials/svg?seed=ada_o',
    nullable: true,
  })
  avatar_url: string | null;

  @ApiProperty({
    description: 'KYC state: NOT_STARTED | PENDING | VERIFIED | REJECTED',
    example: 'NOT_STARTED',
  })
  kyc_status: string;

  @ApiProperty({ description: 'KYC verified badge', example: false })
  kyc_verified: boolean;

  @ApiProperty({ description: 'Account tier: 0 phone-verified, 1 KYC-verified', example: 0 })
  tier: number;

  @ApiProperty({ description: 'Server-owned trust score 0-100', example: 62 })
  trust_score: number;

  @ApiProperty({ description: 'LOW | MEDIUM | TRUSTED', example: 'MEDIUM' })
  trust_tier: string;

  @ApiProperty({
    description: 'Squad virtual account number (null until KYC is verified)',
    example: '0123456789',
    nullable: true,
  })
  squad_virtual_account: string | null;

  @ApiProperty({
    description: 'Squad bank code',
    example: '050',
    nullable: true,
  })
  squad_bank_code: string | null;
}

export class VerifyOtpResponseDto {
  @ApiProperty({
    description: 'JWT access token (15 min TTL)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Rotating refresh token (30 day TTL)',
    example: 'rt_...',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Access token lifetime in seconds',
    example: 900,
  })
  expiresIn: number;

  @ApiProperty({
    description: 'Authenticated user data',
    type: UserDataDto,
  })
  user: UserDataDto;

  @ApiProperty({
    description: 'User wallet info',
    type: WalletDataDto,
  })
  wallet: WalletDataDto;
}

export class RefreshTokenResponseDto {
  @ApiProperty({
    description: 'New JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'New refresh token (the old one is revoked)',
    example: 'rt_...',
  })
  refreshToken: string;

  @ApiProperty({ description: 'Access token lifetime in seconds', example: 900 })
  expiresIn: number;
}

export class OtpResponseDto {
  @ApiProperty({ description: 'Success status', example: true })
  success: boolean;

  @ApiProperty({ description: 'Response message', example: 'OTP sent successfully' })
  message: string;

  @ApiProperty({ description: 'OTP expiry in seconds', example: 300 })
  expires_in: number;

  @ApiProperty({ description: 'Seconds before another code may be requested', example: 60 })
  resend_after: number;
}

export class AvailabilityFieldDto {
  @ApiProperty({
    description: 'available | taken | invalid',
    example: 'available',
    enum: ['available', 'taken', 'invalid'],
  })
  phone?: string;

  @ApiProperty({
    description: 'available | taken | invalid',
    example: 'taken',
    enum: ['available', 'taken', 'invalid'],
  })
  email?: string;

  @ApiProperty({
    description: 'available | taken | invalid',
    example: 'available',
    enum: ['available', 'taken', 'invalid'],
  })
  username?: string;
}
