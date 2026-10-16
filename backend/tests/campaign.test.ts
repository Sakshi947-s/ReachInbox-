import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

describe('Campaign & Scheduling API', () => {
  const app = createApp();
  let authCookie: string;
  let testUserId: string;

  beforeAll(async () => {
    // Authenticate via devLogin to get a real server-side session cookie
    const loginRes = await request(app)
      .post('/api/auth/dev-login')
      .send({ email: 'test.campaign.suite@reachinbox.ai', name: 'Campaign Test User' });

    expect(loginRes.status).toBe(200);
    testUserId = loginRes.body.user.id;
    const cookieHeader = loginRes.headers['set-cookie'];
    authCookie = Array.isArray(cookieHeader) ? cookieHeader[0] : (cookieHeader || '');
  });

  afterAll(async () => {
    // Clean up created campaigns for test user
    if (testUserId) {
      await prisma.campaign.deleteMany({ where: { ownerId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  it('should reject unauthenticated campaign creation with 401', async () => {
    const res = await request(app).post('/api/campaigns').send({
      subject: 'Unauthorized Campaign',
      body: '<p>Test</p>',
      startTime: new Date().toISOString(),
      recipients: ['user@example.com'],
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('should reject invalid campaign input (missing body/subject)', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Cookie', authCookie)
      .send({
        startTime: new Date().toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should reject campaign creation if no valid recipients provided', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Cookie', authCookie)
      .send({
        subject: 'No Recipients',
        body: '<p>Body</p>',
        startTime: new Date().toISOString(),
        recipients: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid recipients');
  });

  it('should successfully create campaign, deduplicate recipients, and calculate staggered schedule', async () => {
    const futureDate = new Date(Date.now() + 3600000); // 1 hour in future
    const delayMs = 3000;

    const res = await request(app)
      .post('/api/campaigns')
      .set('Cookie', authCookie)
      .send({
        name: 'Staggered Q4 ReachOut',
        subject: 'Exclusive Demo',
        body: '<p>Hello from ReachInbox</p>',
        startTime: futureDate.toISOString(),
        delayBetweenEmailsMs: delayMs,
        hourlyLimit: 50,
        recipients: [
          'prospect1@company.com',
          'prospect2@company.com',
          'prospect1@company.com', // Duplicate - should be deduplicated
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.campaign.totalRecipients).toBe(2); // Deduplicated to 2

    const campaignId = res.body.campaign.id;

    // Verify database records in PostgreSQL
    const dbEmailJobs = await prisma.emailJob.findMany({
      where: { campaignId },
      orderBy: { scheduledAt: 'asc' },
    });

    expect(dbEmailJobs.length).toBe(2);
    expect(dbEmailJobs[0].recipientEmail).toBe('prospect1@company.com');
    expect(dbEmailJobs[1].recipientEmail).toBe('prospect2@company.com');

    // Verify staggered delay between job 0 and job 1
    const diff = dbEmailJobs[1].scheduledAt.getTime() - dbEmailJobs[0].scheduledAt.getTime();
    expect(diff).toBe(delayMs);

    // Verify outbox events were recorded
    const outboxCount = await prisma.outboxEvent.count({
      where: { aggregateId: { in: dbEmailJobs.map((j) => j.id) } },
    });
    expect(outboxCount).toBe(2);
  });

  it('should retrieve scheduled and sent emails with user ownership checks', async () => {
    const scheduledRes = await request(app)
      .get('/api/emails/scheduled')
      .set('Cookie', authCookie);

    expect(scheduledRes.status).toBe(200);
    expect(Array.isArray(scheduledRes.body.emails)).toBe(true);
    expect(scheduledRes.body.pagination).toBeDefined();

    const sentRes = await request(app)
      .get('/api/emails/sent')
      .set('Cookie', authCookie);

    expect(sentRes.status).toBe(200);
    expect(Array.isArray(sentRes.body.emails)).toBe(true);
  });
});
