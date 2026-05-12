import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class TransferDto {
  @ApiProperty({
    description: 'Recipient PayDrop user ID',
    example: 'cuid123',
  })
  @IsString()
  recipient_id: string;

  @ApiProperty({
    description: 'Amount in kobo (1 kobo = 0.01 NGN, so 500000 = NGN 5,000)',
    example: 500000,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Idempotency key (UUID per attempt to prevent duplicate transfers)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  idempotency_key: string;

  @ApiProperty({
    description: 'Optional payment note',
    example: 'Payment for goods',
    required: false,
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({
    description:
      'Optional NIP code override (Squad payout bank code). For sandbox, PayDrop will default to the GT/Squad sandbox NIP code if missing/invalid.',
    example: '000013',
    required: false,
  })
  @IsOptional()
  @IsString()
  nip_code?: string;
}

export class ConfirmTransferDto {
  @ApiProperty({
    description: 'Transaction ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  transaction_id: string;

  @ApiProperty({
    description: 'Confirm token (15 minutes TTL)',
    example: '9b6d2b8a-3b72-4e2f-9a28-2a1c3a2a1b11',
  })
  @IsString()
  @IsUUID()
  confirm_token: string;
}

export class FraudFeatures {
  @ApiProperty({ description: 'Amount vs baseline ratio', example: 2.5 })
  amount_vs_baseline: number;

  @ApiProperty({ description: 'Number of transactions in last hour', example: 3 })
  velocity_1hr: number;

  @ApiProperty({
    description: 'Is this recipient a first-time recipient',
    example: false,
  })
  recipient_first_time: boolean;

  @ApiProperty({
    description: 'Is transaction happening at unusual time',
    example: false,
  })
  time_anomaly: boolean;

  @ApiProperty({
    description: 'Does recipient account name match registered name',
    example: true,
  })
  account_name_match: boolean;
}

export class TransferAllowedDto {
  @ApiProperty({
    description: 'Transaction ID for reference',
    example: 'cuid123',
  })
  transaction_id: string;

  @ApiProperty({
    description: 'Transaction status',
    enum: ['COMPLETED', 'PENDING_REVIEW', 'BLOCKED'],
    example: 'COMPLETED',
  })
  status: string;

  @ApiProperty({
    description: 'Fraud risk score (0-100)',
    example: 15,
  })
  fraud_score: number;

  @ApiProperty({
    description: 'Fraud verdict',
    enum: ['ALLOW', 'FLAG', 'BLOCK'],
    example: 'ALLOW',
  })
  verdict: string;

  @ApiProperty({
    description: 'Squad transaction reference (from POST /payout/transfer)',
    example: 'SBPJ4U4VU6_pd_550e8400-e29b-41d4-a716-446655440000',
  })
  squad_ref: string;
}

export class TransferFlaggedDto {
  @ApiProperty({
    description: 'Transaction ID',
    example: 'cuid123',
  })
  transaction_id: string;

  @ApiProperty({
    description: 'Transaction status',
    enum: ['COMPLETED', 'PENDING_REVIEW', 'BLOCKED'],
    example: 'PENDING_REVIEW',
  })
  status: string;

  @ApiProperty({
    description: 'Fraud risk score (0-100)',
    example: 65,
  })
  fraud_score: number;

  @ApiProperty({
    description: 'Fraud verdict',
    enum: ['ALLOW', 'FLAG', 'BLOCK'],
    example: 'FLAG',
  })
  verdict: string;

  @ApiProperty({
    description: 'Human-readable reason for flag',
    example: 'Unusual transaction velocity detected',
  })
  reason: string;

  @ApiProperty({
    description: 'Token required to proceed after user acknowledges',
    example: 'confirm_token_abc123',
  })
  confirm_token: string;
}

export class TransferBlockedDto {
  @ApiProperty({
    description: 'Transaction status',
    enum: ['COMPLETED', 'PENDING_REVIEW', 'BLOCKED'],
    example: 'BLOCKED',
  })
  status: string;

  @ApiProperty({
    description: 'Fraud risk score (0-100)',
    example: 95,
  })
  fraud_score: number;

  @ApiProperty({
    description: 'Fraud verdict',
    enum: ['ALLOW', 'FLAG', 'BLOCK'],
    example: 'BLOCK',
  })
  verdict: string;

  @ApiProperty({
    description: 'Human-readable reason for block',
    example: 'Transaction blocked due to high fraud risk',
  })
  reason: string;
}

export class TransactionDto {
  @ApiProperty({
    description: 'Transaction ID',
    example: 'cuid123',
  })
  id: string;

  @ApiProperty({
    description: 'Sender user ID',
    example: 'cuid_sender',
  })
  sender_id: string;

  @ApiProperty({
    description: 'Recipient user ID',
    example: 'cuid_recipient',
  })
  recipient_id: string;

  @ApiProperty({
    description: 'Amount in kobo',
    example: 500000,
  })
  amount: number;

  @ApiProperty({
    description: 'Transaction status',
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
    example: 'COMPLETED',
  })
  status: string;

  @ApiProperty({
    description: 'Payment note',
    example: 'Payment for goods',
    nullable: true,
  })
  note: string | null;

  @ApiProperty({
    description: 'Squad transaction reference (from POST /payout/transfer)',
    example: 'SBPJ4U4VU6_pd_550e8400-e29b-41d4-a716-446655440000',
  })
  squad_ref: string | null;

  @ApiProperty({
    description: 'Fraud score (0-100)',
    example: 15,
    nullable: true,
  })
  fraud_score: number | null;

  @ApiProperty({
    description: 'Fraud verdict',
    enum: ['ALLOW', 'FLAG', 'BLOCK'],
    example: 'ALLOW',
    nullable: true,
  })
  fraud_verdict: string | null;

  @ApiProperty({
    description: 'Transaction creation date',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Transaction update date',
    example: '2024-01-15T10:31:00Z',
  })
  updatedAt: Date;
}

export class FraudDetailDto {
  @ApiProperty({
    description: 'Fraud risk score (0-100)',
    example: 15,
  })
  score: number;

  @ApiProperty({
    description: 'Fraud verdict',
    enum: ['ALLOW', 'FLAG', 'BLOCK'],
    example: 'ALLOW',
  })
  verdict: string;

  @ApiProperty({
    description: 'Human-readable explanation',
    example: 'Low risk transaction based on user history',
  })
  reason: string;

  @ApiProperty({
    description: 'Top contributing fraud signals',
    type: FraudFeatures,
  })
  features: FraudFeatures;
}
