import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimitOptions {
  /** Redis key, e.g. `rl:discover_resolve:${userId}`. */
  key: string;
  /** Max actions allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Message shown in the 429 body. */
  message?: string;
}

/**
 * Fixed-window counter backed by Redis. Throws a 429 with the shared error
 * envelope (code RATE_LIMITED, details.retry_after) when the limit is passed.
 * Returns the remaining allowance on success.
 */
export async function enforceRateLimit(
  redis: {
    incr: (key: string) => Promise<number>;
    expire: (key: string, ttl: number) => Promise<boolean>;
    ttl: (key: string) => Promise<number>;
  },
  options: RateLimitOptions,
): Promise<number> {
  const count = await redis.incr(options.key);

  if (count === 1) {
    await redis.expire(options.key, options.windowSeconds);
  }

  if (count > options.limit) {
    const ttl = await redis.ttl(options.key);
    const retryAfter = ttl > 0 ? ttl : options.windowSeconds;
    throw new HttpException(
      {
        success: false,
        code: 'RATE_LIMITED',
        message:
          options.message ?? 'Too many requests. Please try again shortly.',
        details: { retry_after: retryAfter },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  return Math.max(0, options.limit - count);
}

/**
 * Blocks a repeated action until the cooldown elapses (e.g. OTP resend).
 * Returns the seconds the caller must still wait, or 0 when allowed.
 */
export async function cooldownRemaining(
  redis: { ttl: (key: string) => Promise<number> },
  key: string,
): Promise<number> {
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}
