import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rateLimiterService } from '../src/services/rate-limiter.service.js';
import { redisClient } from '../src/config/redis.js';

describe('Distributed Hourly Rate Limiter', () => {
  const testSender = `test-${Date.now()}@sender.io`;

  beforeAll(async () => {
    // Ensure clean state for test sender
    const windowKey = rateLimiterService.getQuotaWindowKey(new Date());
    await redisClient.del(`ratelimit:hourly:${testSender}:${windowKey}`);
  });

  afterAll(async () => {
    const windowKey = rateLimiterService.getQuotaWindowKey(new Date());
    await redisClient.del(`ratelimit:hourly:${testSender}:${windowKey}`);
  });

  it('should generate valid UTC window key in YYYY-MM-DD:HH format', () => {
    const date = new Date('2026-10-16T14:35:00Z');
    const key = rateLimiterService.getQuotaWindowKey(date);
    expect(key).toBe('2026-10-16:14');
  });

  it('should compute exact start of next hour in UTC', () => {
    const date = new Date('2026-10-16T14:35:00Z');
    const nextHour = rateLimiterService.getNextWindowStartTime(date);
    expect(nextHour.toISOString()).toBe('2026-10-16T15:00:00.000Z');
  });

  it('should permit sends below the quota limit and increment counter', async () => {
    const limit = 5;

    // First 5 sends should be allowed
    for (let i = 1; i <= 5; i++) {
      const res = await rateLimiterService.reserveHourlyQuota(testSender, limit);
      expect(res.allowed).toBe(true);
      expect(res.currentCount).toBe(i);
      expect(res.hourlyLimit).toBe(limit);
    }

    // 6th send must be rejected (quota exhausted)
    const blockedRes = await rateLimiterService.reserveHourlyQuota(testSender, limit);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.currentCount).toBe(5);
    expect(blockedRes.retryAfterMs).toBeGreaterThan(0);
    expect(blockedRes.nextEligibleTime.getTime()).toBeGreaterThan(Date.now());
  });

  it('should handle concurrent reservation requests atomically without oversubscribing', async () => {
    const concurrentSender = `concurrent-${Date.now()}@sender.io`;
    const limit = 10;
    const windowKey = rateLimiterService.getQuotaWindowKey(new Date());
    await redisClient.del(`ratelimit:hourly:${concurrentSender}:${windowKey}`);

    // Fire 20 parallel requests at the same exact millisecond
    const promises = Array.from({ length: 20 }).map(() =>
      rateLimiterService.reserveHourlyQuota(concurrentSender, limit)
    );

    const results = await Promise.all(promises);

    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;

    // Exactly 10 must be allowed and exactly 10 must be denied
    expect(allowedCount).toBe(10);
    expect(deniedCount).toBe(10);

    // Clean up
    await redisClient.del(`ratelimit:hourly:${concurrentSender}:${windowKey}`);
  });
});
