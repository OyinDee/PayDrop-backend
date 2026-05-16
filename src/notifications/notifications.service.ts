import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ActivityLogService } from '../common/services/activity-log.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Internal — called by other services, never exposed via HTTP
  // ─────────────────────────────────────────────────────────────

  /**
   * Persist a notification row for a user.
   * Fire-and-forget safe — errors are logged, never thrown, so a
   * notification failure never breaks the calling transaction.
   */
  async send(
    userId: string,
    title: string,
    body: string,
  ): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: { user_id: userId, title, body },
      });
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'notification_save_failed',
          user_id: userId,
          title,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Device registration
  // ─────────────────────────────────────────────────────────────

  async registerDevice(userId: string, fcmToken: string, deviceId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.deviceToken.findUnique({
      where: { user_id_device_id: { user_id: userId, device_id: deviceId } },
    });

    await this.prisma.deviceToken.upsert({
      where: { user_id_device_id: { user_id: userId, device_id: deviceId } },
      update: { fcm_token: fcmToken },
      create: { user_id: userId, device_id: deviceId, fcm_token: fcmToken },
    });

    await this.activityLog.log(
      userId,
      existing ? 'DEVICE_CHANGED' : 'DEVICE_REGISTERED',
      { device_id: deviceId },
    );

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────
  // Read / mark-read endpoints
  // ─────────────────────────────────────────────────────────────

  async getNotifications(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    const unreadCount = notifications.filter((n: any) => !n.read).length;

    return {
      unread_count: unreadCount,
      notifications: notifications.map((notif: any) => ({
        id: notif.id,
        title: notif.title,
        message: notif.body,
        read: notif.read,
        createdAt: notif.created_at,
      })),
    };
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.user_id !== userId) {
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