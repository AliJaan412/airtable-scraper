import { getRedisClient } from './redis';
import { config } from '../config';

const PREFIX = 'sred:cache:';

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await getRedisClient().get(`${PREFIX}${key}`);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds = config.redis.cacheTtl): Promise<void> {
    try {
      await getRedisClient().set(`${PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // cache failures must never crash the app
    }
  },

  async del(key: string): Promise<void> {
    try {
      await getRedisClient().del(`${PREFIX}${key}`);
    } catch {
      // ignore
    }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await getRedisClient().keys(`${PREFIX}${pattern}`);
      if (keys.length) await getRedisClient().del(...keys);
    } catch {
      // ignore
    }
  },
};
