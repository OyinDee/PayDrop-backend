import { Controller, Post, Body, Headers, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { Request } from 'express';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post('squad')
  @ApiOperation({
    summary: 'Squad Webhook Receiver',
    description:
      'Receives webhooks from Squad. Validates HMAC SHA512 signature, updates transaction state and wallet balance.',
  })
  @ApiHeader({
    name: 'x-squad-signature',
    description: 'HMAC SHA512 signature for verification',
  })
  @ApiHeader({
    name: 'Content-Type',
    description: 'application/json',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature',
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found',
  })
  async squadWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
    @Headers('x-squad-signature') signature: string,
  ) {
    return this.webhooksService.handleSquadWebhook(req.rawBody, body, signature);
  }
}
