/**
 * backend/tests/slack.test.ts
 *
 * Tests covering:
 * - GET /api/slack/status returns 401 when not authenticated
 * - GET /api/slack/status returns { connected: false, status: 'DISCONNECTED' } when no connection exists
 * - POST /api/slack/test returns 400 when there is no active Slack connection
 * - POST /api/slack/test handles empty token gracefully by marking status ERROR
 * - POST /api/slack/test handles token_revoked Slack API error by transitioning status to ERROR
 * - POST /api/slack/test sends test message successfully when Slack API succeeds
 * - POST /api/slack/disconnect wipes token and sets status to DISCONNECTED
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import type { Express } from 'express';
import { encrypt } from '../src/utils/crypto.js';
import { WebClient } from '@slack/web-api';
import {
  validateSlackConfig,
  postSlackNotification,
  sendSlackSchedulingNotification,
  sendSlackCampaignCompletionNotification,
} from '../src/integrations/slack/client.js';
import { env } from '../src/config/env.js';

let app: Express;
const TEST_USER_EMAIL = 'slack.test.user@reachinbox.ai';
let testUserId: string;

beforeEach(async () => {
  app = createApp();
  const user = await prisma.user.upsert({
    where: { email: TEST_USER_EMAIL },
    update: {},
    create: {
      googleId: `slack-test-${Date.now()}`,
      email: TEST_USER_EMAIL,
      name: 'Slack Test User',
    },
  });
  testUserId = user.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.slackConnection.deleteMany({ where: { ownerId: testUserId } });
  await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
});

describe('GET /api/slack/status', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/slack/status').expect(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns connected: false when no connection exists for the user', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/dev-login')
      .send({ email: TEST_USER_EMAIL })
      .expect(200);

    const res = await agent.get('/api/slack/status').expect(200);
    expect(res.body).toEqual({ connected: false, status: 'DISCONNECTED' });
  });

  it('returns connected: true and connection details without exposing token', async () => {
    await prisma.slackConnection.create({
      data: {
        ownerId: testUserId,
        teamId: 'T12345',
        teamName: 'Acme Workspace',
        channelId: 'C12345',
        channelName: '#notifications',
        accessTokenEncrypted: encrypt('xoxb-fake-token-never-sent'),
        grantedScopes: 'chat:write,channels:read',
        status: 'CONNECTED',
      },
    });

    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent.get('/api/slack/status').expect(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.connection.teamName).toBe('Acme Workspace');
    expect(res.body.connection.channelName).toBe('#notifications');
    // Ensure the encrypted or decrypted token is NEVER leaked to the client
    expect(res.body.connection).not.toHaveProperty('accessTokenEncrypted');
    expect(res.body.connection).not.toHaveProperty('accessToken');
  });
});

describe('POST /api/slack/test', () => {
  it('returns 400 when there is no active Slack connection', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent.post('/api/slack/test').expect(400);
    expect(res.body.error).toBe('No active Slack connection');
  });

  it('handles empty token gracefully by marking status ERROR', async () => {
    await prisma.slackConnection.create({
      data: {
        ownerId: testUserId,
        teamId: 'T12345',
        teamName: 'Acme Workspace',
        channelId: 'C12345',
        accessTokenEncrypted: '',
        grantedScopes: 'chat:write',
        status: 'CONNECTED',
      },
    });

    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent.post('/api/slack/test').expect(400);
    expect(res.body.error).toBe('Slack token is missing or revoked');

    const conn = await prisma.slackConnection.findUnique({ where: { ownerId: testUserId } });
    expect(conn?.status).toBe('ERROR');
  });

  it('handles token_revoked error from Slack API by marking status ERROR', async () => {
    await prisma.slackConnection.create({
      data: {
        ownerId: testUserId,
        teamId: 'T12345',
        teamName: 'Acme Workspace',
        channelId: 'C12345',
        accessTokenEncrypted: encrypt('xoxb-revoked-token'),
        grantedScopes: 'chat:write',
        status: 'CONNECTED',
      },
    });

    // Mock WebClient.prototype.apiCall to throw token_revoked when chat.postMessage is dispatched
    vi.spyOn(WebClient.prototype, 'apiCall').mockImplementation(async (method: string) => {
      if (method === 'chat.postMessage') {
        const err: any = new Error('An API error occurred: token_revoked');
        err.data = { error: 'token_revoked' };
        throw err;
      }
      return { ok: true } as any;
    });

    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent.post('/api/slack/test').expect(400);
    expect(res.body.error).toBe('Slack token is revoked or invalid');
    expect(res.body.slackError).toBe('token_revoked');

    const conn = await prisma.slackConnection.findUnique({ where: { ownerId: testUserId } });
    expect(conn?.status).toBe('ERROR');
  });

  it('sends test message successfully when Slack API succeeds', async () => {
    await prisma.slackConnection.create({
      data: {
        ownerId: testUserId,
        teamId: 'T12345',
        teamName: 'Acme Workspace',
        channelId: 'C12345',
        channelName: '#alerts',
        accessTokenEncrypted: encrypt('xoxb-valid-token'),
        grantedScopes: 'chat:write',
        status: 'CONNECTED',
      },
    });

    vi.spyOn(WebClient.prototype, 'apiCall').mockResolvedValue({
      ok: true,
      ts: '1234567890.123456',
    } as any);

    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent.post('/api/slack/test').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Test message sent to Slack successfully');
  });
});

describe('POST /api/slack/disconnect', () => {
  it('marks connection DISCONNECTED and revokes token without exposing errors', async () => {
    await prisma.slackConnection.create({
      data: {
        ownerId: testUserId,
        teamId: 'T12345',
        teamName: 'Acme Workspace',
        channelId: 'C12345',
        accessTokenEncrypted: encrypt('xoxb-disconnect-token'),
        grantedScopes: 'chat:write',
        status: 'CONNECTED',
      },
    });

    vi.spyOn(WebClient.prototype, 'apiCall').mockResolvedValue({ ok: true } as any);

    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent.post('/api/slack/disconnect').expect(200);
    expect(res.body.success).toBe(true);

    const conn = await prisma.slackConnection.findUnique({ where: { ownerId: testUserId } });
    expect(conn?.status).toBe('DISCONNECTED');
    expect(conn?.accessTokenEncrypted).toBe('REVOKED');
  });
});

describe('validateSlackConfig', () => {
  const originalToken = env.SLACK_BOT_TOKEN;
  const originalChannel = env.SLACK_CHANNEL_ID;

  afterEach(() => {
    (env as any).SLACK_BOT_TOKEN = originalToken;
    (env as any).SLACK_CHANNEL_ID = originalChannel;
  });

  it('returns configured: true when both SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are present', () => {
    (env as any).SLACK_BOT_TOKEN = 'xoxb-mock-token';
    (env as any).SLACK_CHANNEL_ID = 'C1234567890';

    const res = validateSlackConfig();
    expect(res.configured).toBe(true);
    expect(res.mode).toBe('bot');
    expect(res.hasBotToken).toBe(true);
    expect(res.hasChannelId).toBe(true);
    expect(res.channel).toBe('C1234567890');
    expect(res.error).toBeUndefined();
  });

  it('returns configured: false with clear error when token is set but channel is missing', () => {
    (env as any).SLACK_BOT_TOKEN = 'xoxb-mock-token';
    (env as any).SLACK_CHANNEL_ID = '';

    const res = validateSlackConfig();
    expect(res.configured).toBe(false);
    expect(res.hasBotToken).toBe(true);
    expect(res.hasChannelId).toBe(false);
    expect(res.error).toContain('SLACK_CHANNEL_ID is missing');
  });

  it('returns configured: false with clear error when channel is set but token is missing', () => {
    (env as any).SLACK_BOT_TOKEN = '';
    (env as any).SLACK_CHANNEL_ID = 'C1234567890';

    const res = validateSlackConfig();
    expect(res.configured).toBe(false);
    expect(res.hasBotToken).toBe(false);
    expect(res.hasChannelId).toBe(true);
    expect(res.error).toContain('SLACK_BOT_TOKEN is missing');
  });

  it('returns configured: false when neither token nor channel is set', () => {
    (env as any).SLACK_BOT_TOKEN = '';
    (env as any).SLACK_CHANNEL_ID = '';

    const res = validateSlackConfig();
    expect(res.configured).toBe(false);
    expect(res.mode).toBe('none');
    expect(res.hasBotToken).toBe(false);
    expect(res.hasChannelId).toBe(false);
  });
});

describe('sendSlackSchedulingNotification', () => {
  const originalToken = env.SLACK_BOT_TOKEN;
  const originalChannel = env.SLACK_CHANNEL_ID;

  afterEach(() => {
    (env as any).SLACK_BOT_TOKEN = originalToken;
    (env as any).SLACK_CHANNEL_ID = originalChannel;
    vi.restoreAllMocks();
  });

  it('posts scheduling notification with formatted blocks when bot token is active', async () => {
    (env as any).SLACK_BOT_TOKEN = 'xoxb-test-bot-token';
    (env as any).SLACK_CHANNEL_ID = 'C_TEST_SCHEDULE';

    let capturedPostMessageArgs: any = null;
    vi.spyOn(WebClient.prototype, 'apiCall').mockImplementation(async (method: string, args: any) => {
      if (method === 'chat.postMessage') {
        capturedPostMessageArgs = args;
        return { ok: true, ts: '1700000000.000100' } as any;
      }
      return { ok: true } as any;
    });

    const result = await sendSlackSchedulingNotification({
      campaignId: 'camp-12345-uuid',
      ownerId: testUserId,
      name: 'Spring Outreach Campaign',
      subject: 'Special Offer Just for You',
      totalRecipients: 42,
      startTime: new Date('2026-11-01T10:00:00Z'),
      delayBetweenEmailsMs: 5000,
      hourlyLimit: 50,
    });

    expect(result.success).toBe(true);
    expect(result.ts).toBe('1700000000.000100');
    expect(capturedPostMessageArgs).not.toBeNull();
    expect(capturedPostMessageArgs.channel).toBe('C_TEST_SCHEDULE');
    expect(capturedPostMessageArgs.text).toContain('Spring Outreach Campaign');
    expect(capturedPostMessageArgs.text).toContain('42 recipients');
    expect(capturedPostMessageArgs.blocks).toBeDefined();
    expect(capturedPostMessageArgs.blocks[0].text.text).toContain('Email Campaign Scheduled');
  });

  it('handles Slack API failure gracefully without throwing (non-blocking)', async () => {
    (env as any).SLACK_BOT_TOKEN = 'xoxb-failing-bot-token';
    (env as any).SLACK_CHANNEL_ID = 'C_TEST_FAIL';

    vi.spyOn(WebClient.prototype, 'apiCall').mockImplementation(async (method: string) => {
      if (method === 'chat.postMessage') {
        const err: any = new Error('channel_not_found');
        err.data = { error: 'channel_not_found' };
        throw err;
      }
      return { ok: true } as any;
    });

    const result = await sendSlackSchedulingNotification({
      campaignId: 'camp-fail-uuid',
      subject: 'Subject',
      totalRecipients: 5,
      startTime: new Date(),
      delayBetweenEmailsMs: 2000,
      hourlyLimit: 100,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('channel_not_found');
  });
});

describe('sendSlackCampaignCompletionNotification', () => {
  const originalToken = env.SLACK_BOT_TOKEN;
  const originalChannel = env.SLACK_CHANNEL_ID;

  afterEach(() => {
    (env as any).SLACK_BOT_TOKEN = originalToken;
    (env as any).SLACK_CHANNEL_ID = originalChannel;
    vi.restoreAllMocks();
  });

  it('posts completion notification with stats when bot token is active', async () => {
    (env as any).SLACK_BOT_TOKEN = 'xoxb-test-bot-token';
    (env as any).SLACK_CHANNEL_ID = 'C_TEST_COMPLETED';

    let capturedPostMessageArgs: any = null;
    vi.spyOn(WebClient.prototype, 'apiCall').mockImplementation(async (method: string, args: any) => {
      if (method === 'chat.postMessage') {
        capturedPostMessageArgs = args;
        return { ok: true, ts: '1700000000.000200' } as any;
      }
      return { ok: true } as any;
    });

    const result = await sendSlackCampaignCompletionNotification({
      campaignId: 'camp-99999-uuid',
      ownerId: testUserId,
      name: 'Q4 Product Launch',
      subject: 'Introducing Version 2.0',
      totalRecipients: 100,
      sentCount: 98,
      failedCount: 2,
      completedAt: new Date('2026-11-01T12:30:00Z'),
    });

    expect(result.success).toBe(true);
    expect(result.ts).toBe('1700000000.000200');
    expect(capturedPostMessageArgs).not.toBeNull();
    expect(capturedPostMessageArgs.channel).toBe('C_TEST_COMPLETED');
    expect(capturedPostMessageArgs.text).toContain('Q4 Product Launch');
    expect(capturedPostMessageArgs.text).toContain('98/100');
    expect(capturedPostMessageArgs.blocks[0].text.text).toContain('Email Campaign Completed');
  });

  it('falls back to connected user Slack connection when SLACK_BOT_TOKEN is unset', async () => {
    (env as any).SLACK_BOT_TOKEN = '';
    (env as any).SLACK_CHANNEL_ID = '';

    await prisma.slackConnection.create({
      data: {
        ownerId: testUserId,
        teamId: 'T_OAUTH_WORKSPACE',
        teamName: 'OAuth Team',
        channelId: 'C_OAUTH_CHANNEL',
        channelName: '#campaign-updates',
        accessTokenEncrypted: encrypt('xoxb-oauth-token'),
        grantedScopes: 'chat:write',
        status: 'CONNECTED',
      },
    });

    let capturedPostMessageArgs: any = null;
    vi.spyOn(WebClient.prototype, 'apiCall').mockImplementation(async (method: string, args: any) => {
      if (method === 'chat.postMessage') {
        capturedPostMessageArgs = args;
        return { ok: true, ts: '1700000000.000300' } as any;
      }
      return { ok: true } as any;
    });

    const result = await sendSlackCampaignCompletionNotification({
      campaignId: 'camp-oauth-uuid',
      ownerId: testUserId,
      name: 'OAuth User Campaign',
      subject: 'Greetings',
      totalRecipients: 10,
      sentCount: 10,
      failedCount: 0,
    });

    expect(result.success).toBe(true);
    expect(capturedPostMessageArgs).not.toBeNull();
    expect(capturedPostMessageArgs.channel).toBe('C_OAUTH_CHANNEL');
  });

  it('skips safely without errors when Slack is completely unconfigured', async () => {
    (env as any).SLACK_BOT_TOKEN = '';
    (env as any).SLACK_CHANNEL_ID = '';

    const result = await sendSlackCampaignCompletionNotification({
      campaignId: 'camp-none-uuid',
      subject: 'Hello',
      totalRecipients: 5,
      sentCount: 5,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Slack');
  });
});

describe('Campaign creation non-blocking Slack integration', () => {
  it('creates campaign and schedules emails even if Slack API throws an error', async () => {
    (env as any).SLACK_BOT_TOKEN = 'xoxb-error-bot-token';
    (env as any).SLACK_CHANNEL_ID = 'C_CRASH_TEST';

    // Mock Slack WebClient to throw an unexpected network exception
    vi.spyOn(WebClient.prototype, 'apiCall').mockRejectedValue(new Error('Slack service unavailable 503'));

    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: TEST_USER_EMAIL }).expect(200);

    const res = await agent
      .post('/api/campaigns')
      .send({
        name: 'Resilient Campaign',
        subject: 'Works despite Slack outage',
        body: '<p>Testing non-blocking Slack dispatch</p>',
        startTime: new Date(Date.now() + 60000).toISOString(),
        recipients: ['resilient1@example.com', 'resilient2@example.com'],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.campaign).toBeDefined();
    expect(res.body.campaign.totalRecipients).toBe(2);

    // Clean up
    await prisma.campaign.deleteMany({ where: { id: res.body.campaign.id } });
  });
});

