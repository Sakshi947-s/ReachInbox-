/**
 * scripts/test-slack.ts
 *
 * DEV-ONLY manual verification script for the Slack integration.
 * Run with: npx tsx scripts/test-slack.ts
 *
 * ⚠️  This script is intentionally excluded from automated tests.
 *     It makes ONE real Slack API call using the credentials in .env.
 *     Never commit actual token values; .env is already gitignored.
 *
 * Rules enforced:
 *  - Token/channel values are NEVER printed or logged.
 *  - Only the presence and length of each credential is confirmed.
 *  - Exits with code 1 on failure so CI can detect accidental inclusion.
 */

import { env } from '../src/config/env.js';
import { WebClient } from '@slack/web-api';

// ── 1. Guard: abort immediately if accidentally run inside automated test suite ──
if (process.env.VITEST || process.env.CI) {
  console.error(
    '[test-slack] ❌  This script must NOT run inside automated tests or CI pipelines. Aborting.'
  );
  process.exit(1);
}

// ── 2. Validate environment variables (presence only — no values printed) ─────
console.log('\n[test-slack] Verifying Slack environment variables...');

const hasBotToken = typeof env.SLACK_BOT_TOKEN === 'string' && env.SLACK_BOT_TOKEN.trim().length > 0;
const hasChannelId = typeof env.SLACK_CHANNEL_ID === 'string' && env.SLACK_CHANNEL_ID.trim().length > 0;

console.log(`  SLACK_BOT_TOKEN   : ${hasBotToken  ? `✅ loaded (${env.SLACK_BOT_TOKEN.length} chars)`  : '❌ MISSING or empty'}`);
console.log(`  SLACK_CHANNEL_ID  : ${hasChannelId ? `✅ loaded (${env.SLACK_CHANNEL_ID.length} chars)` : '❌ MISSING or empty'}`);

if (!hasBotToken || !hasChannelId) {
  console.error(
    '\n[test-slack] ❌  One or more required Slack credentials are missing.\n' +
    '  Ensure SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are set in backend/.env\n'
  );
  process.exit(1);
}

// ── 3. Attempt a real Slack API call ──────────────────────────────────────────
console.log('\n[test-slack] Posting test message to Slack...');

const client = new WebClient(env.SLACK_BOT_TOKEN);
const channel = env.SLACK_CHANNEL_ID;
const timestamp = new Date().toISOString();

try {
  const response = await client.chat.postMessage({
    channel,
    text: `🧪 *[DEV TEST]* ReachInbox Slack integration verified at ${timestamp}. This is a one-time manual check — not an automated alert.`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🧪 ReachInbox Slack Integration Test',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            '*This is a one-time manual verification message.*\n' +
            'It confirms that the Slack bot token and channel ID are correctly configured.\n\n' +
            `*Timestamp:* ${timestamp}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Triggered by `scripts/test-slack.ts` — DEV ONLY. Safe to ignore in Slack.',
          },
        ],
      },
    ],
  });

  if (response.ok) {
    console.log('\n[test-slack] ✅  SUCCESS — Slack API call succeeded.');
    console.log(`  Channel  : ${response.channel}`);
    console.log(`  Timestamp: ${response.ts}`);
    console.log('  Token    : [not shown]');
    process.exit(0);
  } else {
    console.error('\n[test-slack] ❌  Slack API returned ok=false with no exception.');
    console.error(`  Slack error : ${(response as any).error ?? 'unknown'}`);
    process.exit(1);
  }
} catch (error: any) {
  const slackError: string = error?.data?.error ?? error?.message ?? 'Unknown error';

  console.error('\n[test-slack] ❌  Slack API call FAILED.');
  console.error(`  Slack error code : ${slackError}`);

  // Provide safe, non-sensitive diagnostics
  if (slackError === 'invalid_auth' || slackError === 'token_revoked') {
    console.error('  Diagnosis        : The bot token is invalid or has been revoked.');
    console.error('  Fix              : Regenerate the bot token in your Slack App dashboard and update SLACK_BOT_TOKEN in .env.');
  } else if (slackError === 'channel_not_found') {
    console.error('  Diagnosis        : The channel ID does not exist or the bot has not been invited to it.');
    console.error('  Fix              : Invite the bot to the channel (/invite @YourBot) and confirm SLACK_CHANNEL_ID is correct.');
  } else if (slackError === 'not_in_channel') {
    console.error('  Diagnosis        : The bot is not a member of the target channel.');
    console.error('  Fix              : Invite the bot with /invite @YourBot in Slack.');
  } else if (slackError === 'missing_scope') {
    console.error('  Diagnosis        : The bot token is missing the required `chat:write` OAuth scope.');
    console.error('  Fix              : Add the chat:write scope to your Slack App and reinstall it.');
  } else if (slackError.includes('ECONNREFUSED') || slackError.includes('ENOTFOUND')) {
    console.error('  Diagnosis        : Could not reach the Slack API — check your network connection.');
  }

  process.exit(1);
}
