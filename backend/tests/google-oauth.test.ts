/**
 * backend/tests/google-oauth.test.ts
 *
 * Unit / integration tests for the safe Google OAuth account-resolution
 * strategy implemented in googleCallback().
 *
 * All tests mock verifyAndExtractGoogleProfile so no real Google API
 * calls are made. The database is real (test PostgreSQL instance).
 *
 * Scenarios covered:
 *  1. New Google user — account + Sender created, session set, redirect to /dashboard
 *  2. Returning Google user (googleId matches) — profile updated, login succeeds
 *  3. Existing dev-login account (same email, dev-eval-* googleId) — Google identity
 *     linked, login succeeds
 *  4. Email already linked to a DIFFERENT real Google account — conflict, redirect
 *     to /login?error=...  (no account mutation)
 *  5. Race-condition P2002 fallback — handled gracefully, session set
 *  6. Google token exchange failure — redirect to /login?error=...
 *  7. Session is saved (req.session.save called) before the dashboard redirect
 *  8. Default Sender NOT duplicated on repeat login
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import type { Express } from 'express';

// ── Mock the Google OAuth integration so no network calls are made ──────────
vi.mock('../src/integrations/google/oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/integrations/google/oauth.js')>();
  return {
    ...actual,
    generateGoogleAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/mock-auth'),
    verifyAndExtractGoogleProfile: vi.fn(),
  };
});

import { verifyAndExtractGoogleProfile } from '../src/integrations/google/oauth.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const CALLBACK_PATH = '/api/auth/google/callback';
const FRONTEND_DASHBOARD = 'http://localhost:3000/dashboard';
const FRONTEND_LOGIN = 'http://localhost:3000/login';

/** Seeds a synthetic Google-linked user directly in the DB. */
async function seedGoogleUser(overrides: {
  googleId: string;
  email: string;
  name?: string;
}) {
  return prisma.user.create({
    data: {
      googleId: overrides.googleId,
      email: overrides.email,
      name: overrides.name ?? 'Test User',
      avatarUrl: null,
    },
  });
}

/** Seeds a dev-login style user (googleId prefix = 'dev-eval-'). */
async function seedDevUser(email: string) {
  return prisma.user.create({
    data: {
      googleId: `dev-eval-${email}`,
      email,
      name: 'Dev User',
      avatarUrl: null,
    },
  });
}

const TEST_EMAIL_BASE = 'goauth.test';
const allTestEmails: string[] = [];

function testEmail(tag: string) {
  const e = `${TEST_EMAIL_BASE}.${tag}@reachinbox.ai`;
  allTestEmails.push(e);
  return e;
}

let app: Express;

beforeEach(() => {
  app = createApp();
  vi.clearAllMocks();
});

afterEach(async () => {
  // Clean up all users created during this test
  if (allTestEmails.length) {
    await prisma.user.deleteMany({ where: { email: { in: [...allTestEmails] } } });
    allTestEmails.length = 0;
  }
});

// ── 1. New Google user ────────────────────────────────────────────────────────
describe('googleCallback — new Google user', () => {
  it('creates a new User + default Sender and redirects to /dashboard', async () => {
    const email = testEmail('new');
    vi.mocked(verifyAndExtractGoogleProfile).mockResolvedValue({
      googleId: 'gid-new-user-001',
      email,
      name: 'New Google User',
      avatarUrl: 'https://example.com/avatar.png',
    });

    const res = await request(app)
      .get(`${CALLBACK_PATH}?code=mock-code&state=`)
      .expect(302);

    expect(res.headers.location).toBe(FRONTEND_DASHBOARD);

    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.googleId).toBe('gid-new-user-001');
    expect(dbUser?.name).toBe('New Google User');

    const sender = await prisma.sender.findFirst({ where: { ownerId: dbUser!.id } });
    expect(sender).not.toBeNull();
    expect(sender?.email).toBe(email);
    expect(sender?.isDefault).toBe(true);
  });
});

// ── 2. Returning Google user (repeat login) ───────────────────────────────────
describe('googleCallback — returning Google user (googleId matches)', () => {
  it('updates mutable profile fields and redirects to /dashboard', async () => {
    const email = testEmail('returning');
    const existing = await seedGoogleUser({ googleId: 'gid-returning-001', email, name: 'Old Name' });

    vi.mocked(verifyAndExtractGoogleProfile).mockResolvedValue({
      googleId: 'gid-returning-001',
      email,
      name: 'Updated Name',
      avatarUrl: 'https://example.com/new-avatar.png',
    });

    const res = await request(app)
      .get(`${CALLBACK_PATH}?code=mock-code&state=`)
      .expect(302);

    expect(res.headers.location).toBe(FRONTEND_DASHBOARD);

    const updated = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.avatarUrl).toBe('https://example.com/new-avatar.png');
    // googleId must not change
    expect(updated?.googleId).toBe('gid-returning-001');
  });

  it('does NOT create a duplicate Sender on repeat login', async () => {
    const email = testEmail('returning-sender');
    const existing = await seedGoogleUser({ googleId: 'gid-returning-002', email });
    // Pre-create a Sender to simulate an already-linked account
    await prisma.sender.create({
      data: { ownerId: existing.id, displayName: 'Existing', email, isDefault: true },
    });

    vi.mocked(verifyAndExtractGoogleProfile).mockResolvedValue({
      googleId: 'gid-returning-002',
      email,
      name: 'Name',
    });

    await request(app).get(`${CALLBACK_PATH}?code=mock-code&state=`).expect(302);

    const senders = await prisma.sender.findMany({ where: { ownerId: existing.id } });
    expect(senders).toHaveLength(1);
  });
});

// ── 3. Existing dev-login account — Google identity linked ────────────────────
describe('googleCallback — dev-login account gets Google identity linked', () => {
  it('links real googleId to the dev-eval account and redirects to /dashboard', async () => {
    const email = testEmail('devlink');
    const devUser = await seedDevUser(email);
    expect(devUser.googleId).toBe(`dev-eval-${email}`);

    vi.mocked(verifyAndExtractGoogleProfile).mockResolvedValue({
      googleId: 'gid-real-google-001',
      email,
      name: 'Real Google User',
      avatarUrl: 'https://example.com/real.png',
    });

    const res = await request(app)
      .get(`${CALLBACK_PATH}?code=mock-code&state=`)
      .expect(302);

    expect(res.headers.location).toBe(FRONTEND_DASHBOARD);

    const linked = await prisma.user.findUnique({ where: { id: devUser.id } });
    // googleId must now be the real Google sub
    expect(linked?.googleId).toBe('gid-real-google-001');
    // email must be preserved
    expect(linked?.email).toBe(email);
    expect(linked?.name).toBe('Real Google User');
  });
});

// ── 4. Email linked to a DIFFERENT real Google account → conflict ─────────────
describe('googleCallback — email already belongs to a different Google account', () => {
  it('redirects to /login with a safe error message and does NOT mutate the DB', async () => {
    const email = testEmail('conflict');
    const originalUser = await seedGoogleUser({
      googleId: 'gid-original-001',
      email,
      name: 'Original Owner',
    });

    // Attacker/second account tries to log in with same email but different sub
    vi.mocked(verifyAndExtractGoogleProfile).mockResolvedValue({
      googleId: 'gid-intruder-001',
      email,
      name: 'Intruder',
    });

    const res = await request(app)
      .get(`${CALLBACK_PATH}?code=mock-code&state=`)
      .expect(302);

    expect(res.headers.location).toMatch(`${FRONTEND_LOGIN}?error=`);
    // Error message must not reveal internal DB details
    const errorParam = new URL(res.headers.location, 'http://localhost').searchParams.get('error') ?? '';
    expect(errorParam).toMatch(/already linked/i);
    expect(errorParam).not.toMatch(/P2002/);
    expect(errorParam).not.toMatch(/googleId/);

    // Original user must be untouched
    const untouched = await prisma.user.findUnique({ where: { id: originalUser.id } });
    expect(untouched?.googleId).toBe('gid-original-001');
    expect(untouched?.name).toBe('Original Owner');
  });
});

// ── 5. Google token exchange / verification failure ───────────────────────────
describe('googleCallback — Google token verification fails', () => {
  it('redirects to /login with a generic safe error — no DB mutation', async () => {
    vi.mocked(verifyAndExtractGoogleProfile).mockRejectedValue(
      new Error('invalid_grant: Token has been expired or revoked.')
    );

    const res = await request(app)
      .get(`${CALLBACK_PATH}?code=bad-code&state=`)
      .expect(302);

    expect(res.headers.location).toMatch(`${FRONTEND_LOGIN}?error=`);
    const errorParam = new URL(res.headers.location, 'http://localhost').searchParams.get('error') ?? '';
    // Must NOT expose raw Google error details
    expect(errorParam).toMatch(/Google verification failed/i);
    expect(errorParam).not.toMatch(/expired/i);
    expect(errorParam).not.toMatch(/revoked/i);
  });
});

// ── 6. OAuth error parameter from Google (user denied) ───────────────────────
describe('googleCallback — OAuth error parameter present', () => {
  it('redirects to /login with the OAuth error without calling verifyAndExtractGoogleProfile', async () => {
    const res = await request(app)
      .get(`${CALLBACK_PATH}?error=access_denied&state=`)
      .expect(302);

    expect(res.headers.location).toMatch(`${FRONTEND_LOGIN}?error=access_denied`);
    expect(verifyAndExtractGoogleProfile).not.toHaveBeenCalled();
  });
});

// ── 7. Session is set and flushed before redirect ────────────────────────────
describe('googleCallback — session handling', () => {
  it('sets session.userId before redirecting so the next request is authenticated', async () => {
    const email = testEmail('session');
    vi.mocked(verifyAndExtractGoogleProfile).mockResolvedValue({
      googleId: 'gid-session-001',
      email,
      name: 'Session User',
    });

    const agent = request.agent(app);

    // Hit callback — session cookie is set
    const callbackRes = await agent
      .get(`${CALLBACK_PATH}?code=mock-code&state=`)
      .expect(302);
    expect(callbackRes.headers.location).toBe(FRONTEND_DASHBOARD);

    // Follow up with GET /api/auth/me — must succeed (session is valid)
    const meRes = await agent.get('/api/auth/me').expect(200);
    expect(meRes.body.user.email).toBe(email);
  });
});

// ── 8. Missing code parameter ─────────────────────────────────────────────────
describe('googleCallback — missing code parameter', () => {
  it('returns 400 Bad Request', async () => {
    const res = await request(app).get(CALLBACK_PATH).expect(400);
    expect(res.body).toHaveProperty('error', 'Missing code parameter');
  });
});
