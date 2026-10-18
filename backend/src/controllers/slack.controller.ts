import { Request, Response } from 'express';
import crypto from 'crypto';
import { WebClient } from '@slack/web-api';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { getSlackOAuthUrl, exchangeSlackCode } from '../integrations/slack/client.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';

export async function slackAuth(req: AuthenticatedRequest, res: Response): Promise<void> {
  const state = crypto.randomBytes(16).toString('hex');
  if (req.session) {
    req.session.slackState = state;
  }

  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    res.status(500).json({
      error: 'Slack OAuth not configured',
      message: 'SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be configured in .env',
    });
    return;
  }

  const url = getSlackOAuthUrl(state);
  res.redirect(url);
}

export async function slackCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query;

  if (error) {
    logger.error({ error }, 'Slack OAuth returned error');
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack_error=${encodeURIComponent(String(error))}`);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing code parameter' });
    return;
  }

  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Session expired during Slack authentication' });
    return;
  }

  if (req.session?.slackState && req.session.slackState !== state) {
    logger.warn({ receivedState: state, sessionState: req.session.slackState }, 'Slack OAuth state mismatch');
    res.status(403).json({ error: 'Invalid Slack OAuth state' });
    return;
  }

  try {
    const slackData = await exchangeSlackCode(code);
    const encryptedToken = encrypt(slackData.accessToken);

    await prisma.slackConnection.upsert({
      where: { ownerId: userId },
      update: {
        teamId: slackData.teamId,
        teamName: slackData.teamName,
        slackUserId: slackData.userId,
        channelId: slackData.channelId,
        channelName: slackData.channelName,
        accessTokenEncrypted: encryptedToken,
        grantedScopes: slackData.scope,
        status: 'CONNECTED',
      },
      create: {
        ownerId: userId,
        teamId: slackData.teamId,
        teamName: slackData.teamName,
        slackUserId: slackData.userId,
        channelId: slackData.channelId,
        channelName: slackData.channelName,
        accessTokenEncrypted: encryptedToken,
        grantedScopes: slackData.scope,
        status: 'CONNECTED',
      },
    });

    delete req.session.slackState;
    logger.info({ userId, team: slackData.teamName }, 'Slack connection established successfully');
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack_success=true`);
  } catch (err: any) {
    logger.error({ err }, 'Error during Slack OAuth code exchange');
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack_error=${encodeURIComponent(err.message || 'Slack connection failed')}`);
  }
}

export async function getSlackStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const connection = await prisma.slackConnection.findUnique({
      where: { ownerId: req.user!.id },
      select: {
        teamId: true,
        teamName: true,
        channelId: true,
        channelName: true,
        status: true,
        grantedScopes: true,
        updatedAt: true,
      },
    });

    if (!connection) {
      res.json({ connected: false, status: 'DISCONNECTED' });
      return;
    }

    res.json({
      connected: connection.status === 'CONNECTED',
      connection,
    });
  } catch (error) {
    logger.error({ error }, 'Error checking Slack status');
    res.status(500).json({ error: 'Failed to retrieve Slack status' });
  }
}

export async function disconnectSlack(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    // Best-effort: revoke token at Slack before removing it
    const connection = await prisma.slackConnection.findUnique({
      where: { ownerId: req.user!.id },
    });

    if (connection && connection.status === 'CONNECTED' && connection.accessTokenEncrypted) {
      try {
        const token = decrypt(connection.accessTokenEncrypted);
        const client = new WebClient(token);
        await client.auth.revoke();
        logger.info({ userId: req.user!.id }, 'Slack token revoked at Slack API');
      } catch (revokeErr) {
        // Non-blocking: token may already be invalid
        logger.warn({ revokeErr }, 'Could not revoke Slack token at API (continuing disconnect)');
      }
    }

    // Wipe token and mark DISCONNECTED. Use a non-empty sentinel so decrypt is never
    // accidentally called on an empty string (guarded anyway in testSlackMessage).
    await prisma.slackConnection.updateMany({
      where: { ownerId: req.user!.id },
      data: {
        status: 'DISCONNECTED',
        accessTokenEncrypted: 'REVOKED',
      },
    });

    logger.info({ userId: req.user!.id }, 'Slack connection disconnected by user');
    res.json({ success: true, message: 'Slack disconnected successfully' });
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Slack');
    res.status(500).json({ error: 'Failed to disconnect Slack' });
  }
}


export async function testSlackMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const connection = await prisma.slackConnection.findUnique({
      where: { ownerId: req.user!.id },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      res.status(400).json({ error: 'No active Slack connection' });
      return;
    }

    // Guard: an empty or blank token means the connection was revoked or incorrectly disconnected
    if (!connection.accessTokenEncrypted || connection.accessTokenEncrypted.trim() === '') {
      logger.warn({ userId: req.user!.id }, 'Slack token is empty; marking connection as ERROR');
      await prisma.slackConnection.updateMany({
        where: { ownerId: req.user!.id },
        data: { status: 'ERROR' },
      });
      res.status(400).json({
        error: 'Slack token is missing or revoked',
        message: 'Please disconnect and reconnect your Slack workspace.',
      });
      return;
    }

    const token = decrypt(connection.accessTokenEncrypted);
    const client = new WebClient(token);
    const channel = connection.channelId || '#general';

    await client.chat.postMessage({
      channel,
      text: '✅ *ReachInbox Test Notification*: Your Slack connection is active and ready to receive hourly rate-limit alerts!',
    });

    res.json({ success: true, message: 'Test message sent to Slack successfully' });
  } catch (error: any) {
    logger.error({ error }, 'Error sending test message to Slack');

    // Check for Slack token_revoked or invalid_auth errors
    const slackErrorCode = error?.data?.error;
    if (slackErrorCode === 'token_revoked' || slackErrorCode === 'invalid_auth') {
      // Mark connection as ERROR so UI can prompt reconnect
      await prisma.slackConnection.updateMany({
        where: { ownerId: req.user!.id },
        data: { status: 'ERROR' },
      }).catch(() => {});
      res.status(400).json({
        error: 'Slack token is revoked or invalid',
        message: 'Please disconnect and reconnect your Slack workspace.',
        slackError: slackErrorCode,
      });
      return;
    }

    res.status(500).json({ error: 'Failed to send test message to Slack', details: error.message });
  }
}

