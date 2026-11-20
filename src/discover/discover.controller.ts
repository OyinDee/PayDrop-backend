import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { DiscoverService } from './discover.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RedisService } from '../common/services/redis.service';
import { enforceRateLimit } from '../common/utils/rate-limit.util';
import { BroadcastBleDto, ResolveBleDto, ResolveQrDto } from './dto/discover.dto';

@ApiTags('Discovery')
@ApiHeader({
  name: 'x-device-id',
  required: false,
  description: 'Device identifier (recommended for authenticated requests)',
})
@Controller('discover')
export class DiscoverController {
  constructor(
    private readonly discoverService: DiscoverService,
    private readonly redis: RedisService,
  ) {}

  @Post('broadcast')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start broadcasting',
    description:
      'Register a discovery token for the signed-in user with a 180 s TTL. The body may be empty: the server then issues the UUID (recommended). Call on app foreground and rotate every ~120 s.',
  })
  @ApiResponse({ status: 201, description: 'Token registered' })
  @ApiResponse({ status: 409, description: 'TOKEN_IN_USE' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async broadcast(
    @CurrentUser('sub') userId: string,
    @Body() body: BroadcastBleDto,
  ) {
    await enforceRateLimit(this.redis, {
      key: `rl:discover_broadcast:${userId}`,
      limit: 30,
      windowSeconds: 3600,
      message: 'Too many broadcast registrations. Please try again later.',
    });

    return this.discoverService.registerToken(userId, body?.token, 'ble');
  }

  @Delete('broadcast')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Stop broadcasting',
    description:
      'Revoke every discovery token owned by the caller (BLE and QR). Idempotent.',
  })
  @ApiResponse({ status: 204, description: 'Token removed' })
  async removeBroadcast(@CurrentUser('sub') userId: string) {
    await this.discoverService.removeTokensForUser(userId);
  }

  @Post('resolve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve a discovery token',
    description:
      'Resolve one token (or a scanned batch) to the public profile shown on the review card: name, username, avatar, relationship, trust score and tier.',
  })
  @ApiResponse({ status: 200, description: 'Resolved profile' })
  @ApiResponse({ status: 404, description: 'TOKEN_INVALID' })
  @ApiResponse({ status: 410, description: 'TOKEN_EXPIRED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async resolve(
    @CurrentUser('sub') userId: string,
    @Body() body: ResolveBleDto,
  ) {
    // 60 per minute, with a 20-per-10-seconds burst ceiling.
    await enforceRateLimit(this.redis, {
      key: `rl:discover_resolve:${userId}`,
      limit: 60,
      windowSeconds: 60,
      message: 'Too many discovery lookups. Please slow down.',
    });
    await enforceRateLimit(this.redis, {
      key: `rl:discover_resolve_burst:${userId}`,
      limit: 20,
      windowSeconds: 10,
      message: 'Too many discovery lookups. Please slow down.',
    });

    if (body?.token) {
      return this.discoverService.resolveToken(userId, body.token);
    }

    return this.discoverService.resolveTokens(userId, body?.tokens ?? []);
  }

  @Get('qr')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get your QR payload',
    description:
      'Returns a paydrop://discover?token=… payload and its expiry. Separate from the live BLE token.',
  })
  @ApiResponse({ status: 200, description: 'QR payload' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async getQr(@CurrentUser('sub') userId: string) {
    await enforceRateLimit(this.redis, {
      key: `rl:discover_qr:${userId}`,
      limit: 20,
      windowSeconds: 3600,
      message: 'Too many QR requests. Please try again later.',
    });

    return this.discoverService.getQrToken(userId);
  }

  @Post('qr/resolve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve a scanned QR token',
    description: 'Same contract as POST /discover/resolve.',
  })
  @ApiResponse({ status: 200, description: 'Resolved profile' })
  @ApiResponse({ status: 404, description: 'TOKEN_INVALID' })
  @ApiResponse({ status: 410, description: 'TOKEN_EXPIRED' })
  async resolveQr(
    @CurrentUser('sub') userId: string,
    @Body() body: ResolveQrDto,
  ) {
    await enforceRateLimit(this.redis, {
      key: `rl:discover_resolve:${userId}`,
      limit: 60,
      windowSeconds: 60,
      message: 'Too many discovery lookups. Please slow down.',
    });

    return this.discoverService.resolveToken(userId, body.token);
  }
}
