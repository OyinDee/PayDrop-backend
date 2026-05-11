import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({
    description: 'First name',
    example: 'Oyindamola',
    required: false,
  })
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiProperty({
    description: 'Last name',
    example: 'Ajala',
    required: false,
  })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiProperty({
    description: 'Email address',
    example: 'oyindamola@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'Avatar URL',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class WalletDataDto {
  @ApiProperty({
    description: 'Wallet balance in kobo',
    example: 50000,
  })
  balance: number;

  @ApiProperty({
    description: 'Currency code',
    example: 'NGN',
  })
  currency: string;
}

export class UserProfileDto {
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
    nullable: true,
  })
  avatar_url: string | null;

  @ApiProperty({
    description: 'Squad virtual account number',
    nullable: true,
  })
  squad_virtual_account: string | null;

  @ApiProperty({
    description: 'Squad bank code',
    nullable: true,
    example: '050',
  })
  squad_bank_code: string | null;

  @ApiProperty({ description: 'KYC verification status', example: false })
  kyc_verified: boolean;

  @ApiProperty({
    description: 'User wallet',
    type: WalletDataDto,
  })
  wallet: WalletDataDto;
}

export class PublicUserProfileDto {
  @ApiProperty({ description: 'User ID', example: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'First name',
    example: 'Oyindamola',
  })
  first_name: string;

  @ApiProperty({
    description: 'Last name',
    example: 'Ajala',
  })
  last_name: string;

  @ApiProperty({
    description: 'Avatar URL',
    nullable: true,
  })
  avatar_url: string | null;
}

