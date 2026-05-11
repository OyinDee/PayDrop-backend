import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async registerDevice(userId: string, fcmToken: string, deviceId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.deviceToken.findUnique({
      where: {
        user_id_device_id: {
          user_id: userId,
          device_id: deviceId,
        },
      },
    });

    await this.prisma.deviceToken.upsert({
      where: {
        user_id_device_id: {
          user_id: userId,
          device_id: deviceId,
        },
      },
      update: {
        fcm_token: fcmToken,
      },
      create: {
        user_id: userId,
        device_id: deviceId,
        fcm_token: fcmToken,
      },
    });

    await this.activityLog.log(
      userId,
      existing ? 'DEVICE_CHANGED' : 'DEVICE_REGISTERED',
      { device_id: deviceId },
    );

    return { success: true };
  }

  async getNotifications(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    return {
      notifications: notifications.map((notif: any) => ({
        id: notif.id,
        title: notif.title,
        message: notif.body,
        type: 'generic',
        read: notif.read,
        data: null,
        createdAt: notif.created_at,
      })),
    };
  }

  async markAsRead(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

    return { success: true };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { user_id: userId, read: false },
      data: { read: true },
    });
    return { success: true };
  }
}
