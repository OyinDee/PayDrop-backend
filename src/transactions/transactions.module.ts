import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { FraudService } from '../common/services/fraud.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    PrismaService,
    RedisService,
    FraudService,
    SquadService,
    ActivityLogService,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
