import { Controller, Post, Get, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiHeader, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  TransferDto,
  ConfirmTransferDto,
  TransferAllowedDto,
  TransferFlaggedDto,
  TransferBlockedDto,
  TransactionDto,
  FraudDetailDto,
} from './dto/transaction.dto';

@ApiTags('Transactions')
@ApiExtraModels(TransferAllowedDto, TransferFlaggedDto, TransferBlockedDto)
@ApiHeader({
  name: 'x-device-id',
  required: true,
  description: 'Device identifier required for authenticated requests',
})
@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post('transfer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initiate Transfer',
    description:
      'Initiate a transfer between PayDrop users. Performs fraud pre-scoring, looks up recipient bank details via POST /payout/account/lookup, then initiates payout via POST /payout/transfer if allowed by fraud engine. Returns COMPLETED for low-risk or PENDING_REVIEW for flagged transfers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transfer completed or flagged for review',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TransferAllowedDto) },
        { $ref: getSchemaPath(TransferFlaggedDto) },
      ],
    },
  })
  @ApiResponse({
    status: 422,
    description: 'Transfer blocked by fraud engine',
    type: TransferBlockedDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate idempotency key',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async transfer(
    @CurrentUser('sub') senderId: string,
    @Body() body: TransferDto,
  ) {
    return this.transactionsService.transfer(
      senderId,
      body.recipient_id,
      body.amount,
      body.idempotency_key,
      body.note,
      body.nip_code,
    );
  }

  @Post('transfer/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm Flagged Transfer',
    description:
      'Confirm a flagged transfer. Requires valid confirm_token (15min TTL).',
  })
  @ApiResponse({
    status: 200,
    description: 'Transfer confirmed and initiated',
    type: TransferAllowedDto,
  })
  async confirmTransfer(
    @CurrentUser('sub') senderId: string,
    @Body() body: ConfirmTransferDto,
  ) {
    return this.transactionsService.confirmTransfer(
      senderId,
      body.transaction_id,
      body.confirm_token,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Transaction History',
    description: 'Get paginated transaction history for current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Transactions retrieved',
    schema: {
      type: 'object',
      properties: {
        transactions: { type: 'array', items: { $ref: '#/components/schemas/TransactionDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransactions(
    @CurrentUser('sub') userId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.transactionsService.getTransactions(userId, page, limit);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Transaction Detail',
    description: 'Get single transaction detail including fraud score and verdict',
  })
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction retrieved',
    type: TransactionDto,
  })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransaction(@Param('id') id: string) {
    return this.transactionsService.getTransaction(id);
  }

  @Get(':id/fraud-detail')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Fraud Scoring Details',
    description: 'Get full fraud scoring breakdown for a transaction',
  })
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  @ApiResponse({
    status: 200,
    description: 'Fraud details retrieved',
    type: FraudDetailDto,
  })
  @ApiResponse({ status: 404, description: 'Fraud event not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getFraudDetail(@Param('id') id: string) {
    return this.transactionsService.getFraudDetail(id);
  }
}
