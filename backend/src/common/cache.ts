import { getRedisClient } from './redis';
import { config } from '../config';

const PREFIX = 'sred:cache:';

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await getRedisClient().get(`${PREFIX}${key}`);
      return value ? (JSON.parse(value) as T) : null;
    } catch (err: any) {
      console.warn('[Cache] get failed for key', key, '—', err?.message ?? err);
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds = config.redis.cacheTtl): Promise<void> {
    try {
      await getRedisClient().set(`${PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err: any) {
      console.warn('[Cache] set failed for key', key, '—', err?.message ?? err);
    }
  },

  async del(key: string): Promise<void> {
    try {
      await getRedisClient().del(`${PREFIX}${key}`);
    } catch (err: any) {
      console.warn('[Cache] del failed for key', key, '—', err?.message ?? err);
    }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await getRedisClient().keys(`${PREFIX}${pattern}`);
      if (keys.length) await getRedisClient().del(...keys);
    } catch (err: any) {
      console.warn('[Cache] delPattern failed for pattern', pattern, '—', err?.message ?? err);
    }
  },
};
