import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, IsUUID, IsOptional } from 'class-validator';

export class BroadcastBleDto {
  @ApiProperty({
    description: 'BLE session token (UUID generated client-side)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  token: string;
}

export class BroadcastResponseDto {
  @ApiProperty({ description: 'Success status', example: true })
  success: boolean;

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 180,
  })
  expires_in: number;
}

export class ResolveBleDto {
  @ApiProperty({
    description: 'Array of BLE tokens collected via scan',
    example: [
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001',
    ],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  tokens: string[];
}

export class NearbyUserDto {
  @ApiProperty({ description: 'User ID', example: 'cuid123' })
  id: string;

  @ApiProperty({
    description: 'First name',
    example: 'Oyindamola',
    nullable: true,
  })
  first_name: string | null;

  @ApiProperty({
    description: 'Last name',
    example: 'Ajala',
    nullable: true,
  })
  last_name: string | null;

  @ApiProperty({
    description: 'Avatar URL',
    nullable: true,
  })
  avatar_url: string | null;

  @ApiProperty({
    description: 'Trust tier',
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    example: 'MEDIUM',
  })
  trust_tier: string;

  @ApiProperty({
    description: 'BLE signal distance indicator',
    enum: ['NEAR', 'MEDIUM', 'FAR'],
    example: 'NEAR',
    required: false,
  })
  @IsOptional()
  distance_signal?: string;
}

export class ResolveBleResponseDto {
  @ApiProperty({
    description: 'Array of nearby user profiles',
    type: [NearbyUserDto],
  })
  users: NearbyUserDto[];
}

export class ResolveQrDto {
  @ApiProperty({
    description: 'QR token scanned from recipient',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  token: string;
}

export class ResolveQrResponseDto {
  @ApiProperty({
    description: 'Recipient user profile',
    type: NearbyUserDto,
  })
  user: NearbyUserDto;
}

export class QrTokenResponseDto {
  @ApiProperty({
    description: 'QR token (same as BLE token, encoded for QR display)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  token: string;

  @ApiProperty({
    description: 'Base64-encoded QR payload',
    example: 'NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAw',
  })
  qr_payload: string;
}
