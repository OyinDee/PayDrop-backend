import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { SquadService } from '../common/services/squad.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaService, ActivityLogService, SquadService],
  exports: [UsersService],
})
export class UsersModule {}
