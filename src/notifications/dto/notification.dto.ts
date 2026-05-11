import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Firebase Cloud Messaging device token',
    example: 'eWDVpJFLQ1c:APA91bG...',
  })
  @IsString()
  fcm_token: string;

  @ApiProperty({
    description: 'Device fingerprint / ID',
    example: '4b2b8a8e-2c9a-4f7a-8f24-2c77a0f2e9a1',
  })
  @IsString()
  device_id: string;
}

export class NotificationDto {
  @ApiProperty({
    description: 'Notification ID',
    example: 'cuid123',
  })
  id: string;

  @ApiProperty({
    description: 'Notification title',
    example: 'Payment Received',
  })
  title: string;

  @ApiProperty({
    description: 'Notification message',
    example: 'You received NGN 5,000 from Oyindamola Ajala',
  })
  message: string;

  @ApiProperty({
    description: 'Notification type',
    example: 'payment_received',
  })
  type: string;

  @ApiProperty({
    description: 'Read status',
    example: false,
  })
  read: boolean;

  @ApiProperty({
    description: 'Additional notification data',
    example: { transaction_id: 'cuid123' },
    nullable: true,
  })
  data: any;

  @ApiProperty({
    description: 'Notification creation date',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;
}

export class MarkAsReadDto {
  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;
}

export class RegisterDeviceResponseDto {
  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;
}
