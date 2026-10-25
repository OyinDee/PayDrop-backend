import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsPhoneNumber,
  IsOptional,
  IsUrl,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  Matches,
  ValidateIf,
} from 'class-validator';

/** Must match request-otp intent: login only if user exists; signup only if user does not exist. */
export enum OtpIntent {
  LOGIN = 'login',
  SIGNUP = 'signup',
}

export class RequestOtpDto {
  @ApiProperty({
    description:
      'login: OTP for existing users only. signup: OTP for new registration only (phone must not already be registered).',
    enum: OtpIntent,
    example: OtpIntent.LOGIN,
  })
  @IsEnum(OtpIntent)
  intent: OtpIntent;

  @ApiProperty({
    description: 'Nigerian phone number (e.g. 08012345678)',
    example: '08012345678',
  })
  @IsString()
  @IsPhoneNumber('NG')
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    description:
      'Must match the intent used in request-otp. login: existing user only. signup: new user only; requires identity + BVN fields.',
    enum: OtpIntent,
    example: OtpIntent.LOGIN,
  })
  @IsEnum(OtpIntent)
  intent: OtpIntent;

  @ApiProperty({
    description: 'Nigerian phone number',
    example: '08012345678',
  })
  @IsString()
  @IsPhoneNumber('NG')
  phone: string;

  @ApiProperty({
    description: '6-digit OTP code',
    example: '123456',
  })
  @IsString()
  otp: string;

  @ApiProperty({
    description: 'First name (required for signup only)',
    example: 'Oyindamola',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'first_name is required for signup' })
  @IsString()
  first_name?: string;

  @ApiProperty({
    description: 'Last name (required for signup only)',
    example: 'Ajala',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'last_name is required for signup' })
  @IsString()
  last_name?: string;

  @ApiProperty({
    description:
      'Unique handle, stored lowercase (required for signup). 3–24 characters: letters, numbers, underscore.',
    example: 'oyin_ajala',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'username is required for signup' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,24}$/, {
    message: 'username must be 3–24 characters (letters, numbers, underscore)',
  })
  username?: string;

  @ApiProperty({
    description:
      '11-digit BVN (required for signup). Squad sandbox docs often use test BVN 22110011001; names, DOB, and phone must match what Squad expects for that BVN.',
    example: '22110011001',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'bvn is required for signup' })
  @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string;

  @ApiProperty({
    description:
      'Date of birth (required for signup). Use mm/dd/yyyy, dd/mm/yyyy, or yyyy-mm-dd — normalized for Squad. Must match BVN on Squad side.',
    example: '10/30/1990',
    required: false,
  })
  @ValidateIf((o) => o.intent === OtpIntent.SIGNUP)
  @IsNotEmpty({ message: 'dob is required for signup' })
  @IsString()
  dob?: string;

  @ApiProperty({
    description: 'Email address (optional; used on signup when provided)',
    example: 'oyindamola@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'Avatar URL (optional on signup; if omitted, a default image is generated)',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  avatar_url?: string;
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

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token from previous login',
    example: 'uuid-string',
  })
  @IsString()
  refresh_token: string;
}

export class WalletDataDto {
  @ApiProperty({ description: 'Current balance in kobo', example: 50000 })
  balance: number;

  @ApiProperty({ description: 'Currency code', example: 'NGN' })
  currency: string;
}

export class UserDataDto {
  @ApiProperty({ description: 'User ID', example: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Phone number', example: '08012345678' })
  phone: string;

  @ApiProperty({
    description: 'Public username (null for legacy accounts)',
    example: 'oyin_ajala',
    nullable: true,
  })
  username: string | null;

  @ApiProperty({ description: 'First name', example: 'Oyindamola' })
  first_name: string;

  @ApiProperty({ description: 'Last name', example: 'Ajala' })
  last_name: string;

  @ApiProperty({
    description: 'Email address',
    example: 'oyindamola@example.com',
    nullable: true,
  })
  email: string | null;

  @ApiProperty({
    description: 'Resolved avatar URL (custom or generated)',
    example: 'https://api.dicebear.com/7.x/initials/svg?seed=oyin_ajala',
    nullable: true,
  })
  avatar_url: string | null;

  @ApiProperty({
    description: 'Squad virtual account number',
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

  @ApiProperty({
    description: 'KYC verification status',
    example: false,
  })
  kyc_verified: boolean;
}

export class VerifyOtpResponseDto {
  @ApiProperty({
    description: 'JWT access token (15 min TTL)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token: string;

  @ApiProperty({
    description: 'Refresh token (7 day TTL in Redis)',
    example: 'uuid-string',
  })
  refresh_token: string;

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
  access_token: string;

  @ApiProperty({
    description: 'New refresh token',
    example: 'uuid-string',
  })
  refresh_token: string;
}

export class OtpResponseDto {
  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Response message',
    example: 'OTP sent successfully',
  })
  message: string;

  @ApiProperty({
    description: 'OTP expiry in seconds',
    example: 600,
  })
  expires_in: number;
}

export class LogoutResponseDto {
  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Response message',
    example: 'Logged out successfully',
  })
  message: string;
}
