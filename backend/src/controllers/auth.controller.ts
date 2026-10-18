import { Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { generateGoogleAuthUrl, verifyAndExtractGoogleProfile } from '../integrations/google/oauth.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { getSmtpProvider } from '../integrations/email/smtp.js';

export async function googleAuth(req: Request, res: Response): Promise<void> {
  const state = crypto.randomBytes(16).toString('hex');
  if (req.session) {
    req.session.oauthState = state;
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    res.status(500).json({
      error: 'Google OAuth not configured',
      message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in the environment. Please add them to your .env file.',
    });
    return;
  }

  const url = generateGoogleAuthUrl(state);
  res.redirect(url);
}

export async function googleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query;

  if (error) {
    logger.error({ error }, 'Google OAuth authorization returned error');
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(String(error))}`);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing code parameter' });
    return;
  }

  // Validate state to prevent CSRF attacks
  if (req.session?.oauthState && req.session.oauthState !== state) {
    logger.warn({ receivedState: state, sessionState: req.session.oauthState }, 'OAuth state mismatch');
    res.status(403).json({ error: 'Invalid OAuth state' });
    return;
  }

  let profile: Awaited<ReturnType<typeof verifyAndExtractGoogleProfile>>;
  try {
    profile = await verifyAndExtractGoogleProfile(code);
  } catch (err: any) {
    logger.error({ err }, 'Google token exchange / verification failed');
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Google verification failed')}`);
    return;
  }

  try {
    /**
     * Safe account-resolution strategy executed in a serializable transaction
     * to prevent race-condition duplicates.
     *
     * Priority:
     *  1. Lookup by googleId (returning user – normal repeat login)
     *  2. Lookup by email (first Google login for a pre-existing account)
     *     a. Row has a DIFFERENT non-null googleId → conflict, refuse login
     *     b. Row has a dev-eval googleId prefix → link Google account to it
     *     c. Row has no (null) googleId → impossible by schema, but handled defensively
     *  3. Neither match → create a brand-new user
     */
    const user = await prisma.$transaction(async (tx) => {
      // ── Step 1: look up by Google's immutable subject ID ──────────────────
      const byGoogleId = await tx.user.findUnique({
        where: { googleId: profile.googleId },
      });

      if (byGoogleId) {
        // Returning Google user — update mutable profile fields
        return tx.user.update({
          where: { id: byGoogleId.id },
          data: {
            name: profile.name,
            email: profile.email,
            avatarUrl: profile.avatarUrl ?? byGoogleId.avatarUrl,
          },
        });
      }

      // ── Step 2: no googleId match — look up by verified email ────────────
      const byEmail = await tx.user.findUnique({
        where: { email: profile.email },
      });

      if (byEmail) {
        const isDevAccount = byEmail.googleId.startsWith('dev-eval-');

        if (!isDevAccount) {
          // Email belongs to a real Google account with a DIFFERENT sub — reject
          logger.warn(
            { existingGoogleId: '[redacted]', incomingEmail: profile.email },
            'Google OAuth conflict: email already linked to a different Google account'
          );
          throw new OAuthConflictError(
            'This email is already linked to a different Google account. ' +
            'Please sign in with the original Google account.'
          );
        }

        // Dev / demo account — link the real Google identity to it
        logger.info(
          { userId: byEmail.id },
          'Linking real Google account to existing dev-login account'
        );
        return tx.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: profile.googleId,
            name: profile.name,
            avatarUrl: profile.avatarUrl ?? byEmail.avatarUrl,
          },
        });
      }

      // ── Step 3: completely new user ────────────────────────────────────────
      return tx.user.create({
        data: {
          googleId: profile.googleId,
          name: profile.name,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
        },
      });
    }, { isolationLevel: 'Serializable' });

    // Ensure a default Sender exists — guarded by findFirst to avoid duplicates
    const existingSender = await prisma.sender.findFirst({
      where: { ownerId: user.id },
    });

    if (!existingSender) {
      await prisma.sender.create({
        data: {
          ownerId: user.id,
          displayName: user.name,
          email: user.email,
          isDefault: true,
        },
      });
    }

    // Write session and flush to Redis before redirecting so the cookie
    // is guaranteed to be set when the browser hits /dashboard.
    await new Promise<void>((resolve, reject) => {
      if (!req.session) return resolve();
      req.session.userId = user.id;
      delete req.session.oauthState;
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    logger.info({ userId: user.id, email: user.email }, 'User logged in via Google OAuth');
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err: any) {
    if (err instanceof OAuthConflictError) {
      logger.warn({ message: err.message }, 'Google OAuth account conflict — redirecting with safe error');
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(err.message)}`);
      return;
    }

    // P2002 from a race condition after the transaction — safe fallback
    if (err?.code === 'P2002') {
      logger.warn({ target: err?.meta?.target }, 'Duplicate constraint on Google OAuth upsert (race condition) — retrying as existing user');
      const existing = await prisma.user.findUnique({ where: { email: profile.email } })
        .catch(() => null);
      if (existing) {
        await new Promise<void>((resolve) => {
          if (!req.session) return resolve();
          req.session.userId = existing.id;
          req.session.save(() => resolve());
        });
        res.redirect(`${env.FRONTEND_URL}/dashboard`);
        return;
      }
    }

    logger.error({ err }, 'Error handling Google OAuth callback');
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`);
  }
}

/** Sentinel error for cross-account conflicts — never exposes internal details to the browser. */
class OAuthConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthConflictError';
  }
}

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        senders: { where: { isActive: true } },
        slackConnection: {
          select: {
            teamName: true,
            status: true,
            channelName: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      senders: user.senders,
      slack: user.slackConnection || { status: 'DISCONNECTED' },
    });
  } catch (error) {
    logger.error({ error }, 'Error in getMe');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        logger.error({ err }, 'Error destroying session on logout');
        res.status(500).json({ error: 'Failed to log out' });
        return;
      }
      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Logged out successfully' });
    });
  } else {
    res.json({ success: true, message: 'Already logged out' });
  }
}

/**
 * Returns which OAuth/SMTP integrations are configured without exposing secrets.
 * Safe to call unauthenticated — used by the frontend to conditionally show setup warnings.
 */
export async function getAuthStatus(req: Request, res: Response): Promise<void> {
  const googleOAuthConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const slackConfigured = !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
  const smtpProvider = getSmtpProvider();

  res.json({
    googleOAuthConfigured,
    slackConfigured,
    smtpProvider,           // 'real' | 'ethereal'
    smtpFrom: env.SMTP_FROM,
    isProduction: env.NODE_ENV === 'production',
  });
}

/**
 * Development / Evaluation login helper: allows demoing the full scheduling application
 * if Google OAuth credentials have not yet been provided in .env.
 * Disabled in production to prevent unauthorized session creation.
 */
export async function devLogin(req: Request, res: Response): Promise<void> {
  // Guard: devLogin is disabled in production
  if (env.NODE_ENV === 'production') {
    res.status(403).json({
      error: 'Dev login is disabled in production',
      message: 'Use Google OAuth to sign in.',
    });
    return;
  }

  const email = (req.body?.email || 'demo.evaluator@reachinbox.ai').toLowerCase();
  const name = req.body?.name || 'ReachInbox Evaluator';

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: { name },
      create: {
        googleId: `dev-eval-${email}`,
        name,
        email,
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      },
    });

    // Ensure default Sender
    const sender = await prisma.sender.findFirst({
      where: { ownerId: user.id },
    });

    if (!sender) {
      await prisma.sender.create({
        data: {
          ownerId: user.id,
          displayName: user.name,
          email: user.email,
          isDefault: true,
        },
      });
    }

    if (req.session) {
      req.session.userId = user.id;
    }

    res.json({
      success: true,
      message: 'Demo session established',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error in devLogin');
    res.status(500).json({ error: 'Failed to create demo session' });
  }
}
