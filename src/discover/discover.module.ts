import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { DiscoverController } from './discover.controller';
import { DiscoverService } from './discover.service';
import { AuthModule } from '../auth/auth.module';
import { RedisService } from '../common/services/redis.service';

@Module({
  imports: [CacheModule.register(), AuthModule],
  controllers: [DiscoverController],
  providers: [DiscoverService, RedisService],
  exports: [DiscoverService],
})
export class DiscoverModule {}
