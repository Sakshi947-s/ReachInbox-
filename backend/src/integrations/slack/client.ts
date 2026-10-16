import { WebClient } from '@slack/web-api';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { decrypt } from '../../utils/crypto.js';

export function getSlackOAuthUrl(state: string): string {
  if (!env.SLACK_CLIENT_ID) {
    logger.warn('SLACK_CLIENT_ID is not configured in environment');
  }

  const scopes = ['chat:write', 'channels:read', 'incoming-webhook'].join(',');
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID || '',
    scope: scopes,
    redirect_uri: env.SLACK_CALLBACK_URL,
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackOAuthResult {
  teamId: string;
  teamName: string;
  accessToken: string;
  userId?: string;
  channelId?: string;
  channelName?: string;
  scope: string;
}

export async function exchangeSlackCode(code: string): Promise<SlackOAuthResult> {
  const client = new WebClient();

  const response = await client.oauth.v2.access({
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: env.SLACK_CALLBACK_URL,
  });

  if (!response.ok || !response.access_token) {
    throw new Error(`Slack OAuth exchange failed: ${response.error || 'Unknown error'}`);
  }

  return {
    teamId: response.team?.id || '',
    teamName: response.team?.name || 'Slack Workspace',
    accessToken: response.access_token,
    userId: response.authed_user?.id,
    channelId: (response.incoming_webhook as any)?.channel_id,
    channelName: (response.incoming_webhook as any)?.channel,
    scope: response.scope || '',
  };
}

export interface SendRateLimitAlertParams {
  ownerId: string;
  senderEmail: string;
  hourlyLimit: number;
  quotaWindowKey: string;
  nextEligibleTime: Date;
}

/**
 * Sends a Slack notification when a sender hits the hourly quota limit.
 * Uses QuotaNotificationState to deduplicate notifications per sender per hour.
 */
export async function sendSlackRateLimitNotification(params: SendRateLimitAlertParams): Promise<boolean> {
  try {
    // 1. Check if user has an active Slack connection
    const connection = await prisma.slackConnection.findUnique({
      where: { ownerId: params.ownerId },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      logger.debug({ ownerId: params.ownerId }, 'No active Slack connection for user; skipping notification');
      return false;
    }

    // 2. Check deduplication: only 1 alert per quotaWindowKey per sender
    const existing = await prisma.quotaNotificationState.findUnique({
      where: {
        senderId_quotaWindowKey: {
          senderId: params.senderEmail,
          quotaWindowKey: params.quotaWindowKey,
        },
      },
    });

    if (existing) {
      logger.debug(
        { senderEmail: params.senderEmail, quotaWindowKey: params.quotaWindowKey },
        'Slack alert already sent for this sender and quota window; deduplicating'
      );
      return false;
    }

    // 3. Decrypt token and send notification via Slack WebClient
    const token = decrypt(connection.accessTokenEncrypted);
    const client = new WebClient(token);

    const targetChannel = connection.channelId || '#general';
    const nextFormatted = params.nextEligibleTime.toISOString();

    await client.chat.postMessage({
      channel: targetChannel,
      text: `⚠️ *ReachInbox Hourly Rate Limit Reached* for sender \`${params.senderEmail}\`.\nLimit of ${params.hourlyLimit} emails/hour reached for window \`${params.quotaWindowKey}\`.\nPending jobs have been rescheduled to start at: *${nextFormatted}*.`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ Email Sending Rate Limit Exceeded',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender:*\n${params.senderEmail}`,
            },
            {
              type: 'mrkdwn',
              text: `*Hourly Quota:*\n${params.hourlyLimit} emails/hr`,
            },
            {
              type: 'mrkdwn',
              text: `*Window:*\n${params.quotaWindowKey}`,
            },
            {
              type: 'mrkdwn',
              text: `*Rescheduled Window:*\n${nextFormatted}`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'Remaining jobs are preserved in BullMQ queue and will resume automatically.',
            },
          ],
        },
      ],
    });

    // 4. Record notification state for deduplication
    await prisma.quotaNotificationState.create({
      data: {
        senderId: params.senderEmail,
        quotaWindowKey: params.quotaWindowKey,
      },
    });

    logger.info(
      { senderEmail: params.senderEmail, quotaWindowKey: params.quotaWindowKey, channel: targetChannel },
      'Slack rate limit alert posted successfully'
    );

    return true;
  } catch (error) {
    logger.error({ error, params }, 'Failed to deliver Slack rate limit alert (non-blocking)');
    return false;
  }
}
