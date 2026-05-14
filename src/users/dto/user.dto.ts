import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsNotEmpty, Matches } from 'class-validator';

export class VerifyKycDto {
  @ApiProperty({
    description:
      '11-digit BVN. Squad sandbox examples use 22110011001; name, DOB, and phone on the user must match the BVN per Squad validation.',
    example: '22110011001',
  })
  @IsNotEmpty()
  @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn: string;

  @ApiProperty({
    description: 'Date of birth (mm/dd/yyyy, dd/mm/yyyy, or yyyy-mm-dd). Must match BVN.',
    example: '10/30/1990',
  })
  @IsNotEmpty()
  @IsString()
  dob: string;
}

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

  @ApiProperty({
    description: 'Public username',
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
    description: 'Avatar URL (custom image, or generated default if unset in DB)',
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
    description: 'Public username',
    example: 'oyin_ajala',
    nullable: true,
  })
  username: string | null;

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
    description: 'Avatar URL (resolved default if unset)',
    nullable: true,
  })
  avatar_url: string | null;
}

