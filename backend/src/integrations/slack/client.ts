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

export interface SlackConfigValidation {
  configured: boolean;
  mode: 'bot' | 'oauth' | 'none';
  hasBotToken: boolean;
  hasChannelId: boolean;
  channel?: string;
  error?: string;
}

/**
 * Validates Slack configuration from environment variables safely.
 * Never prints or leaks token secrets.
 */
export function validateSlackConfig(): SlackConfigValidation {
  const hasBotToken = Boolean(env.SLACK_BOT_TOKEN && env.SLACK_BOT_TOKEN.trim().length > 0);
  const hasChannelId = Boolean(env.SLACK_CHANNEL_ID && env.SLACK_CHANNEL_ID.trim().length > 0);

  if (hasBotToken && hasChannelId) {
    return {
      configured: true,
      mode: 'bot',
      hasBotToken: true,
      hasChannelId: true,
      channel: env.SLACK_CHANNEL_ID,
    };
  }

  if (hasBotToken && !hasChannelId) {
    return {
      configured: false,
      mode: 'bot',
      hasBotToken: true,
      hasChannelId: false,
      error: 'SLACK_BOT_TOKEN is configured but SLACK_CHANNEL_ID is missing. Direct bot notifications cannot be delivered.',
    };
  }

  if (!hasBotToken && hasChannelId) {
    return {
      configured: false,
      mode: 'none',
      hasBotToken: false,
      hasChannelId: true,
      error: 'SLACK_CHANNEL_ID is configured but SLACK_BOT_TOKEN is missing. Direct bot notifications cannot be delivered.',
    };
  }

  return {
    configured: false,
    mode: 'none',
    hasBotToken: false,
    hasChannelId: false,
  };
}

export interface PostSlackMessageParams {
  channel?: string;
  text: string;
  blocks?: any[];
  ownerId?: string;
}

export interface SlackNotificationResult {
  success: boolean;
  ts?: string;
  channel?: string;
  reason?: string;
}

/**
 * Sends a message to Slack using WebClient.
 * Prioritizes direct bot token (SLACK_BOT_TOKEN + SLACK_CHANNEL_ID) and falls back
 * to user's OAuth connection if ownerId is provided.
 *
 * Guarantees non-blocking execution: catches errors safely and never throws.
 */
export async function postSlackNotification(params: PostSlackMessageParams): Promise<SlackNotificationResult> {
  const { channel, text, blocks, ownerId } = params;
  const config = validateSlackConfig();

  let client: WebClient | null = null;
  let targetChannel: string | undefined = channel;

  // 1. Prioritize environment-level direct bot token
  if (config.configured && env.SLACK_BOT_TOKEN) {
    client = new WebClient(env.SLACK_BOT_TOKEN);
    targetChannel = channel || env.SLACK_CHANNEL_ID;
  } else if (ownerId) {
    // 2. Fall back to user OAuth connection if available
    try {
      const connection = await prisma.slackConnection.findUnique({
        where: { ownerId },
      });
      if (
        connection &&
        connection.status === 'CONNECTED' &&
        connection.accessTokenEncrypted &&
        connection.accessTokenEncrypted !== 'REVOKED'
      ) {
        const token = decrypt(connection.accessTokenEncrypted);
        client = new WebClient(token);
        targetChannel = channel || connection.channelId || '#general';
      }
    } catch (err) {
      logger.warn({ ownerId, err }, 'Failed to resolve user Slack connection for notification');
    }
  }

  if (!client || !targetChannel) {
    const reason =
      config.error ||
      'Slack notifications not configured (neither SLACK_BOT_TOKEN nor connected user Slack account found)';
    logger.debug({ reason }, 'Skipping Slack notification');
    return { success: false, reason };
  }

  try {
    const response = await client.chat.postMessage({
      channel: targetChannel,
      text,
      blocks,
    });

    logger.info(
      { channel: targetChannel, ts: response.ts },
      'Slack notification posted successfully'
    );

    return {
      success: true,
      ts: response.ts,
      channel: targetChannel,
    };
  } catch (error: any) {
    const slackError = error?.data?.error || error?.message || 'Unknown Slack API error';
    logger.error(
      { channel: targetChannel, slackError },
      'Slack notification delivery failed (non-blocking)'
    );
    return {
      success: false,
      reason: slackError,
    };
  }
}

export interface SchedulingNotificationParams {
  campaignId: string;
  ownerId?: string;
  name?: string | null;
  subject: string;
  totalRecipients: number;
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  channel?: string;
}

/**
 * Dispatches a Slack notification when an email campaign is successfully scheduled.
 * Never throws: non-blocking.
 */
export async function sendSlackSchedulingNotification(
  params: SchedulingNotificationParams
): Promise<SlackNotificationResult> {
  try {
    const title = params.name ? `*${params.name}*` : `Campaign \`${params.campaignId.slice(0, 8)}\``;
    const startTimeFormatted = params.startTime.toISOString();
    const delaySeconds = Math.round(params.delayBetweenEmailsMs / 1000);

    const fallbackText = `📅 *Email Campaign Scheduled*: ${title} (${params.totalRecipients} recipient${params.totalRecipients === 1 ? '' : 's'}) starting at ${startTimeFormatted}`;

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📅 Email Campaign Scheduled',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Campaign:*\n${params.name || 'Untitled Campaign'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Subject:*\n${params.subject}`,
          },
          {
            type: 'mrkdwn',
            text: `*Recipients:*\n${params.totalRecipients}`,
          },
          {
            type: 'mrkdwn',
            text: `*Scheduled Start:*\n${startTimeFormatted}`,
          },
          {
            type: 'mrkdwn',
            text: `*Delay Between Emails:*\n${delaySeconds}s (${params.delayBetweenEmailsMs}ms)`,
          },
          {
            type: 'mrkdwn',
            text: `*Hourly Limit:*\n${params.hourlyLimit} emails/hr`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Campaign ID: \`${params.campaignId}\` • Status: *SCHEDULED*`,
          },
        ],
      },
    ];

    return await postSlackNotification({
      ownerId: params.ownerId,
      channel: params.channel,
      text: fallbackText,
      blocks,
    });
  } catch (error: any) {
    logger.error({ error, campaignId: params.campaignId }, 'Unhandled error in sendSlackSchedulingNotification (non-blocking)');
    return { success: false, reason: error.message };
  }
}

export interface CampaignCompletionNotificationParams {
  campaignId: string;
  ownerId?: string;
  name?: string | null;
  subject: string;
  totalRecipients: number;
  sentCount: number;
  failedCount?: number;
  completedAt?: Date;
  channel?: string;
}

/**
 * Dispatches a Slack notification when all emails in a campaign have finished delivery.
 * Never throws: non-blocking.
 */
export async function sendSlackCampaignCompletionNotification(
  params: CampaignCompletionNotificationParams
): Promise<SlackNotificationResult> {
  try {
    const title = params.name ? `*${params.name}*` : `Campaign \`${params.campaignId.slice(0, 8)}\``;
    const completedAt = params.completedAt || new Date();
    const completedAtFormatted = completedAt.toISOString();
    const failedCount = params.failedCount || 0;

    const fallbackText = `🎉 *Email Campaign Completed*: ${title} sent ${params.sentCount}/${params.totalRecipients} emails at ${completedAtFormatted}`;

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎉 Email Campaign Completed',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Campaign:*\n${params.name || 'Untitled Campaign'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Subject:*\n${params.subject}`,
          },
          {
            type: 'mrkdwn',
            text: `*Total Recipients:*\n${params.totalRecipients}`,
          },
          {
            type: 'mrkdwn',
            text: `*Successfully Sent:*\n${params.sentCount}`,
          },
          {
            type: 'mrkdwn',
            text: `*Failed / Cancelled:*\n${failedCount}`,
          },
          {
            type: 'mrkdwn',
            text: `*Completed At:*\n${completedAtFormatted}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Campaign ID: \`${params.campaignId}\` • Status: *COMPLETED*`,
          },
        ],
      },
    ];

    return await postSlackNotification({
      ownerId: params.ownerId,
      channel: params.channel,
      text: fallbackText,
      blocks,
    });
  } catch (error: any) {
    logger.error({ error, campaignId: params.campaignId }, 'Unhandled error in sendSlackCampaignCompletionNotification (non-blocking)');
    return { success: false, reason: error.message };
  }
}

