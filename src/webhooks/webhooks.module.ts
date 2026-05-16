import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { RedisService } from '../common/services/redis.service';
import { SquadService } from '../common/services/squad.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { WalletModule } from '../wallet/wallet.module';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [WalletModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    RedisService,
    SquadService,
    ActivityLogService,
    JwtService
  ],
})
export class WebhooksModule {}
