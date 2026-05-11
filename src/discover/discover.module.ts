import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { DiscoverController } from './discover.controller';
import { DiscoverService } from './discover.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RedisService } from '../common/services/redis.service';

@Module({
  imports: [CacheModule.register(), AuthModule],
  controllers: [DiscoverController],
  providers: [DiscoverService, PrismaService, RedisService],
  exports: [DiscoverService],
})
export class DiscoverModule {}
