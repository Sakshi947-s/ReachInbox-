import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redisClient } from '../config/redis.js';

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  hourlyLimit: number;
  quotaWindowKey: string;
  nextEligibleTime: Date;
  retryAfterMs: number;
}

/**
 * Redis Lua script to atomically check and increment the hourly sending count for a sender.
 * Keys:
 *   KEYS[1]: rate_limit:{senderId}:{windowKey}
 * Arguments:
 *   ARGV[1]: hourlyLimit (max allowed)
 *   ARGV[2]: ttlSeconds (window expiration, 7200s to cover full window)
 *
 * Returns:
 *   [1 (allowed) | 0 (denied), currentCount]
 */
const HOURLY_RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = redis.call('GET', key)
if current == false then
  redis.call('SET', key, 1, 'EX', ttl)
  return {1, 1}
end

current = tonumber(current)
if current < limit then
  local new_count = redis.call('INCR', key)
  return {1, new_count}
else
  return {0, current}
end
`;

export class RateLimiterService {
  private redis: Redis;

  constructor(client: Redis = redisClient) {
    this.redis = client;
  }

  /**
   * Generates a time-based window key formatted as YYYY-MM-DD:HH (in UTC)
   */
  public getQuotaWindowKey(date: Date = new Date()): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${d}:${h}`;
  }

  /**
   * Calculates the exact start of the next hour in UTC.
   */
  public getNextWindowStartTime(date: Date = new Date()): Date {
    const next = new Date(date);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  /**
   * Atomically checks and reserves an hourly sending quota for a given sender.
   */
  public async reserveHourlyQuota(
    senderEmail: string,
    campaignHourlyLimit?: number
  ): Promise<RateLimitCheckResult> {
    const effectiveLimit = Math.min(
      campaignHourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      env.MAX_EMAILS_PER_HOUR_PER_SENDER
    );

    const now = new Date();
    const windowKey = this.getQuotaWindowKey(now);
    const redisKey = `ratelimit:hourly:${senderEmail}:${windowKey}`;
    const nextEligibleTime = this.getNextWindowStartTime(now);
    const retryAfterMs = Math.max(1000, nextEligibleTime.getTime() - now.getTime());

    try {
      const result = (await this.redis.eval(
        HOURLY_RATE_LIMIT_LUA,
        1,
        redisKey,
        effectiveLimit,
        7200 // 2 hour TTL
      )) as [number, number];

      const allowed = result[0] === 1;
      const currentCount = result[1];

      if (!allowed) {
        logger.warn(
          { senderEmail, windowKey, currentCount, effectiveLimit, retryAfterMs },
          'Hourly rate limit reached for sender'
        );
      }

      return {
        allowed,
        currentCount,
        hourlyLimit: effectiveLimit,
        quotaWindowKey: windowKey,
        nextEligibleTime,
        retryAfterMs,
      };
    } catch (error) {
      logger.error({ error, senderEmail }, 'Error evaluating rate limit Lua script');
      // On Redis failure, fail safe by allowing if needed or re-throwing
      throw error;
    }
  }

  /**
   * Enforces minimum inter-email delay per sender across distributed workers.
   * Uses Redis timestamp coordination:
   * Sets the last sent timestamp; if the previous timestamp was within MIN_DELAY_BETWEEN_EMAILS_MS,
   * delays worker execution concurrency-safely.
   */
  public async coordinateMinDelay(senderEmail: string, delayMs: number = env.MIN_DELAY_BETWEEN_EMAILS_MS): Promise<void> {
    if (delayMs <= 0) return;

    const key = `ratelimit:last_sent:${senderEmail}`;
    const now = Date.now();

    // Atomically get the previous send timestamp and set new timestamp to now + delayMs
    // We use a Lua script to atomically reserve the send slot
    const LUA_SLOT_RESERVATION = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local delay = tonumber(ARGV[2])
      
      local last = redis.call('GET', key)
      local eligibleTime = now
      
      if last ~= false then
        local lastTime = tonumber(last)
        if lastTime + delay > eligibleTime then
          eligibleTime = lastTime + delay
        end
      end
      
      redis.call('SET', key, eligibleTime, 'PX', delay * 10)
      return eligibleTime - now
    `;

    try {
      const waitTime = (await this.redis.eval(LUA_SLOT_RESERVATION, 1, key, now, delayMs)) as number;
      if (waitTime > 0) {
        logger.debug({ senderEmail, waitTime }, `Throttling send to respect minimum inter-email delay`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } catch (err) {
      logger.warn({ err }, 'Error coordinating min send delay; continuing');
    }
  }
}

export const rateLimiterService = new RateLimiterService();
