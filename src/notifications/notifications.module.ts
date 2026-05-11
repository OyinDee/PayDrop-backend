import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../common/prisma/prisma.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    PrismaService,
    ActivityLogService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
