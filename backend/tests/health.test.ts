import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Health & Diagnostic Endpoints', () => {
  const app = createApp();

  it('GET /api/health should return status ok and uptime', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /api/health/ready should check postgres and redis connectivity', async () => {
    const res = await request(app).get('/api/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.postgres).toBeDefined();
    expect(res.body.checks.redis).toBeDefined();

    if (res.status === 200) {
      expect(res.body.checks.postgres.status).toBe('up');
      expect(res.body.checks.redis.status).toBe('up');
    }
  });
});
