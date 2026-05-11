import { Controller, Post, Get, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DiscoverService } from './discover.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtGuard } from '../common/guards/jwt.guard';
import {
  BroadcastBleDto,
  BroadcastResponseDto,
  ResolveBleDto,
  ResolveBleResponseDto,
  ResolveQrDto,
  ResolveQrResponseDto,
  QrTokenResponseDto,
} from './dto/discover.dto';

@ApiTags('Discovery')
@Controller('discover')
export class DiscoverController {
  constructor(private discoverService: DiscoverService) {}

  @Post('broadcast')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register BLE Token',
    description:
      'Register current user BLE session token in Redis with 3-minute TTL. Call on app foreground.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token registered',
    type: BroadcastResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async broadcast(
    @CurrentUser('sub') userId: string,
    @Body() body: BroadcastBleDto,
  ) {
    return this.discoverService.registerToken(userId, body.token);
  }

  @Post('resolve')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve BLE Tokens',
    description:
      'Resolve array of collected BLE tokens to user profiles. Returns nearby users list.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens resolved to user list',
    type: ResolveBleResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async resolve(
    @CurrentUser('sub') userId: string,
    @Body() body: ResolveBleDto,
  ) {
    return this.discoverService.resolveTokens(userId, body.tokens);
  }

  @Get('qr')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get QR Token',
    description: 'Get current user QR token (same as BLE token, encoded for QR display)',
  })
  @ApiResponse({
    status: 200,
    description: 'QR token retrieved',
    type: QrTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getQr(@CurrentUser('sub') userId: string) {
    return this.discoverService.getQrToken(userId);
  }

  @Post('qr/resolve')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve QR Token',
    description: 'Resolve single QR-scanned token to user profile',
  })
  @ApiResponse({
    status: 200,
    description: 'QR token resolved to user profile',
    type: ResolveQrResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async resolveQr(@Body() body: ResolveQrDto) {
    return this.discoverService.resolveQrToken(body.token);
  }

  @Delete('broadcast')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove BLE Token',
    description:
      'Remove user token from Redis (on app background/close)',
  })
  @ApiResponse({
    status: 200,
    description: 'Token removed',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async removeBroadcast(@CurrentUser('sub') userId: string) {
    return this.discoverService.removeTokenForUser(userId);
  }
}
