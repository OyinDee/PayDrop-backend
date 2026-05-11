import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService {
  private client: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL is not configured');
    }

    const connectTimeoutMs = Number(
      this.configService.get<string>('REDIS_CONNECT_TIMEOUT_MS') || 10000,
    );

    let redisPkg: any = null;
    try {
      // use require to avoid TypeScript module resolution failures when types are not installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      redisPkg = require('redis');
    } catch (e) {
      throw new Error('`redis` package is not installed');
    }

    this.client = redisPkg.createClient({
      url: redisUrl,
      socket: {
        connectTimeout: Number.isFinite(connectTimeoutMs)
          ? connectTimeoutMs
          : 10000,
      },
    });
    this.client.on('error', (err: unknown) => console.error('Redis error:', err));

    try {
      await this.client.connect();
      await this.client.ping();
      console.log("Redis HAS CONNECTED!")
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to connect to Redis (REDIS_URL). ${msg}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  /**
   * Get value from Redis
   */
  async get<T = any>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  /**
   * Set value in Redis with optional TTL (seconds)
   */
  async set<T = any>(
    key: string,
    value: T,
    ttl?: number,
  ): Promise<void> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await this.client.setEx(key, ttl, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Delete key from Redis
   */
  async del(key: string | string[]): Promise<number> {
    if (Array.isArray(key)) {
      return await this.client.del(key);
    }
    return await this.client.del([key]);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  /**
   * Get multiple values
   */
  async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    const values = await this.client.mGet(keys);
    return values.map((v: string | null) => {
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    });
  }

  /**
   * Increment counter
   */
  async incr(key: string): Promise<number> {
    return await this.client.incr(key);
  }

  /**
   * Set TTL on existing key
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    return (await this.client.expire(key, ttl)) > 0;
  }

  /**
   * Get TTL of key (seconds, -1 if no expiry, -2 if not exists)
   */
  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }

  /**
   * Flush all data (use with caution)
   */
  async flushAll(): Promise<void> {
    await this.client.flushAll();
  }
}
