/**
 * backend/tests/smtp.test.ts
 *
 * Tests covering:
 * - getSmtpProvider() returns 'real' when SMTP_USER+SMTP_PASS are set, 'ethereal' otherwise
 * - sendEmail() uses the real transporter path when credentials are present
 * - sendEmail() uses the Ethereal transporter path when credentials are absent
 * - verifySmtpConfig() returns { ok, provider, message } without throwing
 * - POST /api/emails/test-send returns 401 when unauthenticated
 * - POST /api/emails/test-send returns structured response when authenticated
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Express } from 'express';
import {
  getSmtpProvider,
  verifySmtpConfig,
  sendEmail,
  getSmtpDiagnostics,
  _setTransporterForTesting,
} from '../src/integrations/email/smtp.js';

let app: Express;

beforeEach(() => {
  app = createApp();
});

afterEach(() => {
  _setTransporterForTesting(null, null, null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Unit tests for smtp.ts module
// ---------------------------------------------------------------------------
describe('getSmtpProvider()', () => {
  it('returns "ethereal" or "real" correctly depending on SMTP credentials', () => {
    const hasRealCreds = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
    const provider = getSmtpProvider();
    expect(provider).toBe(hasRealCreds ? 'real' : 'ethereal');
  });
});

describe('verifySmtpConfig()', () => {
  it('returns ok=true when transporter.verify succeeds', async () => {
    const mockTransporter: any = {
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn(),
    };
    _setTransporterForTesting(mockTransporter, 'real', null);

    const result = await verifySmtpConfig();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('real');
    expect(result.message).toContain('SMTP verified');
  });

  it('returns ok=false with message when transporter.verify rejects', async () => {
    const mockTransporter: any = {
      verify: vi.fn().mockRejectedValue(new Error('Connection refused')),
      sendMail: vi.fn(),
    };
    _setTransporterForTesting(mockTransporter, 'real', null);

    const result = await verifySmtpConfig();

    expect(result.ok).toBe(false);
    expect(result.provider).toBe('real');
    expect(result.message).toContain('Connection refused');
  });
});

describe('sendEmail()', () => {
  it('returns success=true and a messageId when transporter.sendMail succeeds', async () => {
    const mockTransporter: any = {
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id-123' }),
    };
    _setTransporterForTesting(mockTransporter, 'real', null);

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('test-message-id-123');
    expect(result.provider).toBe('real');
  });

  it('throws when transporter.sendMail rejects so BullMQ can trigger retries', async () => {
    const mockTransporter: any = {
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockRejectedValue(new Error('SMTP auth failed')),
    };
    _setTransporterForTesting(mockTransporter, 'real', null);

    await expect(
      sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      })
    ).rejects.toThrow('SMTP auth failed');
  });
});

// ---------------------------------------------------------------------------
// Integration tests for POST /api/emails/test-send endpoint
// ---------------------------------------------------------------------------
describe('POST /api/emails/test-send', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/emails/test-send').expect(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('returns a structured response when authenticated and mock SMTP is active', async () => {
    if (process.env.NODE_ENV === 'production') return;

    // Set up mock transporter before invoking endpoint
    const mockTransporter: any = {
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-msg-id-789' }),
    };
    _setTransporterForTesting(mockTransporter, 'real', null);

    const agent = request.agent(app);

    // Authenticate via devLogin
    await agent
      .post('/api/auth/dev-login')
      .send({ email: 'smtp.test.user@reachinbox.ai', name: 'SMTP Test User' })
      .set('Content-Type', 'application/json')
      .expect(200);

    const res = await agent.post('/api/emails/test-send').expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('provider', 'real');
    expect(res.body).toHaveProperty('messageId', 'mock-msg-id-789');
    expect(res.body).toHaveProperty('smtpVerified', true);

    // Clean up test user
    const { prisma } = await import('../src/config/prisma.js');
    await prisma.user.deleteMany({ where: { email: 'smtp.test.user@reachinbox.ai' } });
  });

  it('returns 502 with structured error details when SMTP verification fails', async () => {
    if (process.env.NODE_ENV === 'production') return;

    // Transporter that fails verification
    const mockTransporter: any = {
      verify: vi.fn().mockRejectedValue(new Error('Invalid SMTP credentials')),
      sendMail: vi.fn(),
    };
    _setTransporterForTesting(mockTransporter, 'real', null);

    const agent = request.agent(app);

    await agent
      .post('/api/auth/dev-login')
      .send({ email: 'smtp.fail.user@reachinbox.ai', name: 'SMTP Fail User' })
      .set('Content-Type', 'application/json')
      .expect(200);

    const res = await agent.post('/api/emails/test-send').expect(502);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error', 'SMTP verification failed');
    expect(res.body).toHaveProperty('details');
    expect(res.body.details).toContain('Invalid SMTP credentials');

    const { prisma } = await import('../src/config/prisma.js');
    await prisma.user.deleteMany({ where: { email: 'smtp.fail.user@reachinbox.ai' } });
  });

  it('GET /api/emails/smtp-diagnostic returns safe diagnostics without credentials', async () => {
    if (process.env.NODE_ENV === 'production') return;

    const agent = request.agent(app);

    await agent
      .post('/api/auth/dev-login')
      .send({ email: 'smtp.diag.user@reachinbox.ai', name: 'SMTP Diag User' })
      .set('Content-Type', 'application/json')
      .expect(200);

    const res = await agent.get('/api/emails/smtp-diagnostic').expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('diagnostic');
    const diag = res.body.diagnostic;

    expect(diag).toHaveProperty('host');
    expect(diag).toHaveProperty('port');
    expect(diag).toHaveProperty('secure');
    expect(diag).toHaveProperty('hasUser');
    expect(diag).toHaveProperty('hasPass');
    expect(diag).toHaveProperty('passCharCount');
    expect(diag).toHaveProperty('provider');

    // Security assertions: NEVER expose credentials or secrets
    expect(diag).not.toHaveProperty('pass');
    expect(diag).not.toHaveProperty('password');
    expect(diag).not.toHaveProperty('user');
    expect(diag).not.toHaveProperty('username');
    expect(typeof diag.hasPass).toBe('boolean');
    expect(typeof diag.passCharCount).toBe('number');
    expect(typeof diag.secure).toBe('boolean');

    const { prisma } = await import('../src/config/prisma.js');
    await prisma.user.deleteMany({ where: { email: 'smtp.diag.user@reachinbox.ai' } });
  });
});

describe('getSmtpDiagnostics() unit test', () => {
  it('reports configuration metadata safely', () => {
    const diag = getSmtpDiagnostics();
    expect(typeof diag.host).toBe('string');
    expect(typeof diag.port).toBe('number');
    expect(typeof diag.secure).toBe('boolean');
    expect(typeof diag.hasUser).toBe('boolean');
    expect(typeof diag.hasPass).toBe('boolean');
    expect(typeof diag.passCharCount).toBe('number');
    expect(diag.passCharCount).toBeGreaterThanOrEqual(0);
    // Ensure no credential leak
    expect((diag as any).pass).toBeUndefined();
    expect((diag as any).password).toBeUndefined();
    expect((diag as any).user).toBeUndefined();
  });
});
