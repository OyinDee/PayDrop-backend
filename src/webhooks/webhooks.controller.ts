import { Controller, Post, Body, Headers, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBody } from '@nestjs/swagger';
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
      'Receives webhooks from Squad. Validates HMAC SHA512 signature (x-squad-signature header), updates transaction state and wallet balance based on payout/transfer completion.',
  })
  @ApiHeader({
    name: 'x-squad-signature',
    required: true,
    description: 'HMAC SHA512 signature from Squad for webhook validation',
  })
  @ApiHeader({
    name: 'Content-Type',
    required: true,
    description: 'application/json',
  })
  @ApiBody({
    description: 'Squad webhook payload for payout transfer completion',
    schema: {
      type: 'object',
      properties: {
        event: { type: 'string', example: 'payout.transfer.completed' },
        data: {
          type: 'object',
          properties: {
            transaction_reference: { type: 'string', example: 'SBPJ4U4VU6_pd_550e8400-e29b-41d4-a716-446655440000' },
            amount: { type: 'string', example: '50000' },
            status: { type: 'string', example: 'successful' },
            response_description: { type: 'string', example: 'Transfer completed' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing x-squad-signature header',
  })
  @ApiResponse({
    status: 404,
    description: 'Transaction not found in database',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error while processing webhook',
  })
  async squadWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
    @Headers('x-squad-signature') signature: string,
  ) {
    return this.webhooksService.handleSquadWebhook(req.rawBody, body, signature);
  }
}
