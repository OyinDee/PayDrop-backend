import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService {
  private client: any;

  constructor() {
    const { PrismaClient } = require('@prisma/client');
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }

    const adapter = new PrismaPg({ connectionString });
    this.client = new PrismaClient({ adapter });
  }

  get user() {
    return this.client.user;
  }

  get wallet() {
    return this.client.wallet;
  }

  get transaction() {
    return this.client.transaction;
  }

  get notification() {
    return this.client.notification;
  }

  get deviceToken() {
    return this.client.deviceToken;
  }

  get activityLog() {
    return this.client.activityLog;
  }

  get fraudEvent() {
    return this.client.fraudEvent;
  }

  async $connect() {
    return this.client.$connect();
  }

  async $disconnect() {
    return this.client.$disconnect();
  }

  // Proxy $transaction to support transactional operations in services
  async $transaction<R>(arg: any): Promise<R> {
    return this.client.$transaction(arg);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
