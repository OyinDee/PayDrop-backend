import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  AvailabilityFieldDto,
  CheckAvailabilityDto,
  RequestOtpDto,
  TestLoginDto,
  VerifyOtpDto,
  RefreshTokenDto,
  OtpResponseDto,
  VerifyOtpResponseDto,
  RefreshTokenResponseDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@ApiHeader({
  name: 'x-device-id',
  required: false,
  description: 'Stable per-install identifier. Binds refresh tokens to a device.',
})
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('check-availability')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check phone / email / username availability',
    description:
      'Pre-check identifiers before sending an OTP. Each field answers available, taken or invalid. Sends nothing and reveals nothing else.',
  })
  @ApiBody({ type: CheckAvailabilityDto })
  @ApiResponse({ status: 200, type: AvailabilityFieldDto })
  async checkAvailability(@Body() body: CheckAvailabilityDto) {
    return this.authService.checkAvailability(body);
  }

  @Post('request-otp')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request OTP',
    description:
      'Send a 6-digit code by SMS for login or signup. Codes live 5 minutes; resend cooldown 60s; max 5 per phone per hour.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ status: 200, type: OtpResponseDto })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND (login, unknown phone)' })
  @ApiResponse({ status: 409, description: 'ACCOUNT_EXISTS (signup, known phone)' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async requestOtp(@Body() body: RequestOtpDto) {
    return this.authService.requestOtp(body.phone, body.intent);
  }

  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify OTP — login or signup',
    description:
      'Requires intent matching request-otp. login: existing users only. signup: creates the user + wallet in one transaction with phone, name, username and optional email. No BVN or date of birth is collected.',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, type: VerifyOtpResponseDto })
  @ApiResponse({ status: 401, description: 'OTP_INVALID' })
  @ApiResponse({ status: 410, description: 'OTP_EXPIRED' })
  @ApiResponse({ status: 409, description: 'USERNAME_TAKEN / EMAIL_TAKEN / ACCOUNT_EXISTS' })
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.verifyOtp(body, deviceId);
  }

  @Post('test-login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'TEST ONLY - log in as a preset account (no SMS)',
    description:
      'Disabled unless AUTH_TEST_MODE is enabled. Signs in as one of 3 preset test accounts and creates the user + wallet on first use.',
  })
  @ApiBody({ type: TestLoginDto })
  @ApiResponse({ status: 200, type: VerifyOtpResponseDto })
  @ApiResponse({ status: 404, description: 'Test auth is disabled' })
  async testLogin(
    @Body() body: TestLoginDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.testLogin(body?.account, deviceId);
  }

  @Get('test-accounts')
  @ApiOperation({
    summary: 'TEST ONLY - list preset accounts and the fixed OTP',
  })
  @ApiResponse({ status: 404, description: 'Test auth is disabled' })
  async testAccounts() {
    return this.authService.listTestAccounts();
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate the token pair',
    description:
      'Accepted body: { refreshToken }. Rotating revokes the old token; replaying a rotated token revokes the whole session family.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, type: RefreshTokenResponseDto })
  @ApiResponse({ status: 401, description: 'REFRESH_INVALID' })
  async refresh(
    @Body() body: RefreshTokenDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.refreshAccessToken(body, deviceId);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoke the session server-side',
    description:
      'Sends { refreshToken } and revokes it. Idempotent: always 204, even when the token is unknown.',
  })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  async logout(@Body() body: RefreshTokenDto) {
    await this.authService.logout(body?.refreshToken ?? body?.refresh_token);
  }
}
