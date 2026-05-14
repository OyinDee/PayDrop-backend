import { Controller, Post, Get, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiHeader, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  TransferDto,
  ConfirmTransferDto,
  SquadAccountLookupDto,
  RecipientContactTransferInsightDto,
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

  @Post('squad-account-lookup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Squad NIP account lookup (recipient VA)',
    description:
      'Resolves the recipient’s Squad-linked bank account name via Squad payout account lookup, before calling POST /transactions/transfer.',
  })
  @ApiResponse({ status: 200, description: 'Lookup result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async squadAccountLookup(
    @Body() body: SquadAccountLookupDto,
  ) {
    return this.transactionsService.lookupRecipientSquadPayoutAccount(
      body.recipient_id,
      body.nip_code,
    );
  }

  @Post('transfer/recipient-contact-insight')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Friends who paid this recipient',
    description:
      'Accepts the user’s contact phone numbers and returns how many of those contacts (PayDrop users) have completed a prior transfer to the chosen recipient — social proof before sending money.',
  })
  @ApiResponse({ status: 200, description: 'Insight counts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async recipientContactInsight(
    @CurrentUser('sub') requesterUserId: string,
    @Body() body: RecipientContactTransferInsightDto,
  ) {
    return this.transactionsService.recipientContactTransferInsight(
      requesterUserId,
      body.recipient_id,
      body.contacts,
    );
  }

  @Post('transfer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initiate Transfer',
    description:
      'Initiate a transfer between PayDrop users. Performs fraud pre-scoring, verifies the recipient’s Squad virtual account via NIP lookup, then initiates payout. For a standalone NIP lookup (e.g. UI preview), use POST /transactions/squad-account-lookup.',
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
