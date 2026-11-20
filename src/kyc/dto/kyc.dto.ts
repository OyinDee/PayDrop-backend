import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class KycVerifyDto {
  @ApiProperty({
    description: '11-digit BVN. Stored encrypted; only the last 4 digits are ever returned.',
    example: '22110011001',
  })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'bvn must be exactly 11 digits' })
  bvn: string;

  @ApiProperty({
    description: 'Date of birth in YYYY-MM-DD',
    example: '1994-03-21',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dob must be YYYY-MM-DD',
  })
  dob: string;

  @ApiProperty({
    description: 'User consent to run the identity check',
    example: true,
    required: false,
  })
  @IsOptional()
  consent?: boolean;
}
