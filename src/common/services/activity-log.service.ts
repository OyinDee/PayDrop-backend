import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Use a string alias for operation to avoid depending on generated prisma enum types
export type ActivityLogOperation = string;

@Injectable()
export class ActivityLogService {
  constructor(private prisma: PrismaService) {}

  /**
   * Log an activity
   */
  async log(
    userId: string | null | undefined,
    operation: ActivityLogOperation,
    metadata?: Record<string, any>,
    ipAddress?: string,
    deviceId?: string,
  ): Promise<void> {
    try {
      if (!userId || !isUuid(userId)) {
        return;
      }

      const userExists = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!userExists) {
        return;
      }

      await this.prisma.activityLog.create({
        data: {
          user_id: userId,
          operation,
          metadata: metadata || {},
          ip_address: ipAddress,
          device_id: deviceId,
        },
      });
    } catch (error) {
      // Log errors but don't throw - activity logging shouldn't break the main flow
      console.error('Failed to log activity:', error);
    }
  }

  /**
   * Get activity logs for user
   */
  async getUserLogs(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<any[]> {
    return await this.prisma.activityLog.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get logs by operation type
   */
  async getLogsByOperation(
    userId: string,
    operation: ActivityLogOperation,
    limit: number = 50,
  ): Promise<any[]> {
    return await this.prisma.activityLog.findMany({
      where: {
        user_id: userId,
        operation,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
