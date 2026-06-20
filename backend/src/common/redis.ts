import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
      // Exponential backoff — prevents log spam when Redis is unavailable
      retryStrategy: (times) => {
        if (times > 20) return null; // stop retrying after 20 attempts
        return Math.min(times * 500, 10_000); // 0.5s → 10s cap
      },
    });

    redisClient.on('error', (err) => {
      // Only log the first occurrence to avoid log spam
      if ((redisClient as any)._errorLogCount === undefined) {
        (redisClient as any)._errorLogCount = 0;
      }
      (redisClient as any)._errorLogCount++;
      if ((redisClient as any)._errorLogCount <= 3) {
        console.error('[Redis] connection error:', err.message);
        if ((redisClient as any)._errorLogCount === 3) {
          console.error('[Redis] Suppressing further connection errors. Is Redis running at', config.redis.url, '?');
        }
      }
    });

    redisClient.on('connect', () => {
      (redisClient as any)._errorLogCount = 0;
      console.log('[Redis] connected');
    });
  }
  return redisClient;
}

export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/** Returns true only when Redis is reachable AND version >= 5.0.0 (required by BullMQ). */
export async function isRedisCompatible(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const info = await client.info('server');
    const match = info.match(/redis_version:(\d+)\.(\d+)/);
    if (!match) return false;
    const major = parseInt(match[1], 10);
    if (major < 5) {
      const version = info.match(/redis_version:([^\r\n]+)/)?.[1] ?? 'unknown';
      console.warn(`[Redis] version ${version} is too old for BullMQ (requires >= 5.0.0). Scraper queue disabled — jobs will run inline without retry.`);
      console.warn('[Redis] Upgrade options: Docker (`docker run -d -p 6379:6379 redis:7-alpine`), WSL2, or https://github.com/tporadowski/redis/releases');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
