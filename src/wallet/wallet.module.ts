import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { RedisService } from '../common/services/redis.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { NotificationsModule } from '../notifications/notifications.module';



@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    RedisService,
    SquadService,
    ActivityLogService,
  ],
  exports: [WalletService],
})
export class WalletModule {}
