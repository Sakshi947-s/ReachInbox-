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
    await prisma.slackConnection.updateMany({
      where: { ownerId: req.user!.id },
      data: {
        status: 'DISCONNECTED',
        accessTokenEncrypted: '',
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
    res.status(500).json({ error: 'Failed to send test message to Slack', details: error.message });
  }
}
