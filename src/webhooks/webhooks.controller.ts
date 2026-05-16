import { Controller, Post, Get, Body, Headers, Req, Query, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBody, ApiParam } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { Request } from 'express';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private webhooksService: WebhooksService) {}

  @Post('squad')
  @ApiOperation({
    summary: 'Squad Webhook Receiver',
    description:
      'Receives webhooks from Squad. Validates HMAC SHA512 signature (x-squad-signature header). Auto-credits users when transfers complete, processes withdrawals, handles top-ups.',
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
        event_type: { type: 'string', example: 'payout.transfer.completed' },
        data: {
          type: 'object',
          properties: {
            transaction_ref: { type: 'string', example: 'SBPJ4U4VU6_pd_550e8400-e29b-41d4-a716-446655440000' },
            squad_ref: { type: 'string' },
            amount: { type: 'string', example: '50000' },
            status: { type: 'string', example: 'successful' },
            response_description: { type: 'string', example: 'Transfer completed' },
            virtual_account_number: { type: 'string', description: 'For top-up webhooks' },
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
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing x-squad-signature header',
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
    try {
      return await this.webhooksService.handleSquadWebhook(req.rawBody, body, signature);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        JSON.stringify({
          event: 'webhook_handler_error',
          error: err.message,
          stack: err.stack,
        }),
      );
      throw error;
    }
  }

  /**
   * DEBUG ENDPOINTS (for troubleshooting - protect with JWT in production)
   */

  @Get('health')
  @ApiOperation({
    summary: '[DEBUG] Webhook Health Metrics',
    description: 'Get webhook processing health metrics for last 24 hours. Internal endpoint only.',
  })
  @ApiResponse({ status: 200, description: 'Health metrics' })
  async getHealth() {
    return this.webhooksService.getWebhookHealthMetrics();
  }

  @Get('pending-transfers')
  @ApiOperation({
    summary: '[DEBUG] Get Pending Transfers',
    description: 'List transfers stuck in PENDING state (waiting for webhook). Internal endpoint only.',
  })
  @ApiResponse({ status: 200, description: 'Pending transfers' })
  async getPending(@Query('limit') limit: number = 50) {
    return this.webhooksService.getPendingTransfers(Math.min(limit, 100));
  }

  @Get('find/:squadRef')
  @ApiParam({
    name: 'squadRef',
    description: 'Squad reference ID (e.g., SBPJ4U4VU6_pd_...)',
    example: 'SBPJ4U4VU6_pd_d1ffdfe6-34ec-4ef1-8638-6313c1dd539e',
  })
  @ApiOperation({
    summary: '[DEBUG] Find Transaction by Squad Ref',
    description: 'Look up a transaction by its squad_ref for debugging. Internal endpoint only.',
  })
  @ApiResponse({ status: 200, description: 'Transaction details' })
  async findBySquadRef(@Param('squadRef') squadRef: string) {
    if (!squadRef) {
      return { error: 'squad_ref is required' };
    }
    return this.webhooksService.findBySquadRef(squadRef);
  }
}