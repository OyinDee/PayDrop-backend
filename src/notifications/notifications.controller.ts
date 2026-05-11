import { Controller, Post, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiHeader } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtGuard } from '../common/guards/jwt.guard';
import {
  RegisterDeviceDto,
  RegisterDeviceResponseDto,
  NotificationDto,
  MarkAsReadDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiHeader({
  name: 'x-device-id',
  required: true,
  description: 'Device identifier required for authenticated requests',
})
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Post('register-device')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register FCM Device Token',
    description: 'Register device token for push notifications',
  })
  @ApiResponse({
    status: 200,
    description: 'Device registered',
    type: RegisterDeviceResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDevice(
    @CurrentUser('sub') userId: string,
    @Body() body: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(
      userId,
      body.fcm_token,
      body.device_id,
    );
  }

  @Get()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Notifications',
    description: 'Get notification history for current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications retrieved',
    schema: {
      type: 'object',
      properties: {
        notifications: { type: 'array', items: { $ref: '#/components/schemas/NotificationDto' } },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getNotifications(@CurrentUser('sub') userId: string) {
    return this.notificationsService.getNotifications(userId);
  }

  @Patch(':id/read')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark Notification as Read',
    description: 'Mark a notification as read',
  })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read',
    type: MarkAsReadDto,
  })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  @Patch('read-all')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark All Notifications as Read',
    description: 'Mark all notifications as read for current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications marked as read',
    type: MarkAsReadDto,
  })
  async markAllAsRead(@CurrentUser('sub') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
