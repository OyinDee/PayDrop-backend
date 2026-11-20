import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KycService } from './kyc.service';
import { KycVerifyDto } from './dto/kyc.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('KYC')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Optional KYC state and tier limits',
    description:
      'KYC is not required to use PayDrop. Tier 0 is phone-verified; Tier 1 is KYC-verified.',
  })
  @ApiResponse({ status: 200, description: 'KYC status and limits' })
  async status(@CurrentUser('sub') userId: string) {
    return this.kycService.status(userId);
  }

  @Post('verify')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Submit BVN and date of birth (optional, later)',
    description:
      'Rate limited to 3 attempts per day. A mismatch returns 422 KYC_MISMATCH and can be retried; the account is never locked.',
  })
  @ApiResponse({ status: 202, description: 'KYC submitted' })
  @ApiResponse({ status: 409, description: 'KYC_ALREADY_VERIFIED' })
  @ApiResponse({ status: 422, description: 'KYC_MISMATCH' })
  async verify(
    @CurrentUser('sub') userId: string,
    @Body() body: KycVerifyDto,
  ) {
    return this.kycService.verify(userId, body);
  }
}
