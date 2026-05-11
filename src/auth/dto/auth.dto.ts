import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsPhoneNumber,
  IsOptional,
  IsUrl,
  IsEmail,
} from 'class-validator';

export class RequestOtpDto {
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
    description: 'First name (REQUIRED for first login)',
    example: 'Oyindamola',
  })
  @IsString()
  first_name: string;

  @ApiProperty({
    description: 'Last name (REQUIRED for first login)',
    example: 'Ajala',
  })
  @IsString()
  last_name: string;

  @ApiProperty({
    description: 'Email address (optional)',
    example: 'oyindamola@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'Avatar URL (optional)',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  avatar_url?: string;
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
    description: 'Avatar URL',
    example: 'https://example.com/avatar.jpg',
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
