import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export function createRedisConnection(name = 'default'): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
  });

  client.on('connect', () => {
    logger.info(`Redis client [${name}] connected`);
  });

  client.on('error', (err) => {
    logger.error({ err, client: name }, `Redis client [${name}] error`);
  });

  return client;
}

export const redisClient = createRedisConnection('app');
