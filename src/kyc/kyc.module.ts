import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { RedisService } from '../common/services/redis.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [KycController],
  providers: [KycService, RedisService, ActivityLogService],
  exports: [KycService],
})
export class KycModule {}
