import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Wallet Balance',
    description: 'Get current wallet balance in kobo from local database',
  })
  @ApiResponse({
    status: 200,
    description: 'Balance retrieved',
    schema: {
      properties: {
        balance: { type: 'number', example: 50000 },
        currency: { type: 'string', example: 'NGN' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBalance(@CurrentUser('sub') userId: string): Promise<any> {
    return await this.walletService.getBalance(userId);
  }

  @Get('account')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Squad Virtual Account',
    description:
      'Get Squad virtual account number and bank details for receiving top-ups',
  })
  @ApiResponse({
    status: 200,
    description: 'Account details retrieved',
    schema: {
      properties: {
        virtual_account_number: { type: 'string' },
        bank_code: { type: 'string' },
        account_name: { type: 'string' },
        bank_name: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async getAccount(@CurrentUser('sub') userId: string): Promise<any> {
    return await this.walletService.getAccount(userId);
  }

  @Post('withdraw')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Withdraw to External Bank',
    description:
      'Initiate withdrawal to external bank account via Squad Transfer API',
  })
  @ApiBody({
    schema: {
      properties: {
        amount: { type: 'number', description: 'Amount in kobo', example: 50000 },
        bank_code: { type: 'string', description: 'Bank code', example: '050' },
        account_number: { type: 'string', example: '0123456789' },
        account_name: { type: 'string', example: 'Oyindamola Ajala' },
        idempotency_key: {
          type: 'string',
          description: 'UUID for idempotency',
        },
      },
      required: [
        'amount',
        'bank_code',
        'account_number',
        'account_name',
        'idempotency_key',
      ],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Withdrawal initiated',
    schema: {
      properties: {
        transaction_id: { type: 'string' },
        status: { type: 'string', example: 'PENDING' },
        squad_ref: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Duplicate idempotency key' })
  async withdraw(
    @CurrentUser('sub') userId: string,
    @Body()
    body: {
      amount: number;
      bank_code: string;
      account_number: string;
      account_name: string;
      idempotency_key: string;
    },
  ): Promise<any> {
    return await this.walletService.withdraw(
      userId,
      BigInt(body.amount),
      body.bank_code,
      body.account_number,
      body.account_name,
      body.idempotency_key,
    );
  }

  @Post('simulate-topup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Simulate Top-Up (Sandbox Only)',
    description:
      'Trigger a simulated top-up payment via Squad sandbox. Fires real webhook.',
  })
  @ApiBody({
    schema: {
      properties: {
        amount: {
          type: 'number',
          description: 'Amount in NAIRA (not kobo)',
          example: 500,
        },
      },
      required: ['amount'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Simulation triggered',
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async simulateTopup(
    @CurrentUser('sub') userId: string,
    @Body() body: { amount: number },
  ): Promise<any> {
    return await this.walletService.simulateTopup(userId, body.amount);
  }
}
