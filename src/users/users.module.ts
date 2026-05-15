import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ActivityLogService } from '../common/services/activity-log.service';
import { SquadService } from '../common/services/squad.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, ActivityLogService, SquadService],
  exports: [UsersService],
})
export class UsersModule {}
