import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
} from 'class-validator';

export class BroadcastBleDto {
  @ApiProperty({
    description:
      'UUID to advertise. Optional: when omitted the server issues one (recommended).',
    example: '9b2c4f7e-6a31-4d58-8c0e-1f5a2b7d9e43',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  token?: string;
}

/**
 * The app resolves one token at a time; `tokens` stays supported for BLE
 * scanners that batch sightings.
 */
export class ResolveBleDto {
  @ApiProperty({
    description: 'A single discovery token',
    example: '9b2c4f7e-6a31-4d58-8c0e-1f5a2b7d9e43',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  token?: string;

  @ApiProperty({
    description: 'Batch of tokens observed during one BLE scan window',
    example: ['9b2c4f7e-6a31-4d58-8c0e-1f5a2b7d9e43'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  tokens?: string[];
}

export class ResolveQrDto {
  @ApiProperty({
    description: 'Token from the scanned QR payload',
    example: '9b2c4f7e-6a31-4d58-8c0e-1f5a2b7d9e43',
  })
  @IsString()
  @IsUUID()
  token: string;
}
