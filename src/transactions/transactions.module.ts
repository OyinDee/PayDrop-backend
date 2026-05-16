import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { RedisService } from '../common/services/redis.service';
import { FraudService } from '../common/services/fraud.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { AutoCreditService } from './auto-credit.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, WalletModule, NotificationsModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    RedisService,
    FraudService,
    SquadService,
    AutoCreditService,
    ActivityLogService,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
