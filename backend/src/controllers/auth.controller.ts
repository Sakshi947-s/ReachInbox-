import { Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { generateGoogleAuthUrl, verifyAndExtractGoogleProfile } from '../integrations/google/oauth.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';

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

  try {
    const profile = await verifyAndExtractGoogleProfile(code);

    // Upsert User in PostgreSQL
    const user = await prisma.user.upsert({
      where: { googleId: profile.googleId },
      update: {
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      },
      create: {
        googleId: profile.googleId,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      },
    });

    // Ensure a default Sender exists for the user
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

    // Set server-side session
    if (req.session) {
      req.session.userId = user.id;
      delete req.session.oauthState;
    }

    logger.info({ userId: user.id, email: user.email }, 'User logged in via Google OAuth');
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err: any) {
    logger.error({ err }, 'Error handling Google OAuth callback');
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(err.message || 'OAuth failure')}`);
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
 * Development / Evaluation login helper: allows demoing the full scheduling application
 * if Google OAuth credentials have not yet been provided in .env.
 */
export async function devLogin(req: Request, res: Response): Promise<void> {
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
