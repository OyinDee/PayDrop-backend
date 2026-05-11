import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  RequestOtpDto,
  VerifyOtpDto,
  RefreshTokenDto,
  OtpResponseDto,
  VerifyOtpResponseDto,
  RefreshTokenResponseDto,
  LogoutResponseDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('request-otp')
  @ApiOperation({
    summary: 'Request OTP',
    description: 'Send OTP to phone via Termii SMS. Rate limited: 3 per 10 minutes.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully',
    type: OtpResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid phone or rate limited' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async requestOtp(@Body() body: RequestOtpDto): Promise<OtpResponseDto> {
    return await this.authService.requestOtp(body.phone);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Verify OTP & Login',
    description:
      'Verify OTP code. On first login: creates user + Squad VA + wallet atomically.',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP verified, tokens issued',
    type: VerifyOtpResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid OTP or missing required fields' })
  @ApiResponse({ status: 401, description: 'OTP verification failed' })
  async verifyOtp(@Body() body: VerifyOtpDto): Promise<VerifyOtpResponseDto> {
    return await this.authService.verifyOtp(body);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh Access Token',
    description:
      'Exchange refresh token for new access token. Old token invalidated immediately.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'New tokens issued',
    type: RefreshTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() body: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    return await this.authService.refreshAccessToken(body);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'x-device-id',
    required: true,
    description: 'Device identifier required for authenticated requests',
  })
  @ApiOperation({
    summary: 'Logout',
    description: 'Delete refresh token from Redis. Access token expires naturally.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
    type: LogoutResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(
    @Body() body: RefreshTokenDto,
    @CurrentUser() user: any,
  ): Promise<LogoutResponseDto> {
    return await this.authService.logout(body.refresh_token);
  }
}

