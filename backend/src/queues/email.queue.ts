import { Queue, JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createRedisConnection } from '../config/redis.js';

export const EMAIL_QUEUE_NAME = 'email-queue';

export interface EmailJobPayload {
  emailJobId: string;
  campaignId: string;
  ownerId: string;
  senderId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string; // ISO string
  hourlyLimit?: number;
  delayBetweenEmailsMs?: number;
}

const queueRedisConnection = createRedisConnection('queue');

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: queueRedisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24h for monitoring
      count: 5000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

emailQueue.on('error', (err) => {
  logger.error({ err }, `Error in BullMQ queue [${EMAIL_QUEUE_NAME}]`);
});

/**
 * Schedules an email job with deterministic ID derived from the database EmailJob ID.
 */
export async function scheduleEmailJob(
  payload: EmailJobPayload,
  scheduledDate: Date
): Promise<string> {
  const now = Date.now();
  const delay = Math.max(0, scheduledDate.getTime() - now);

  // Deterministic job ID: email-{emailJobId}
  const jobId = `email-${payload.emailJobId}`;

  const options: JobsOptions = {
    jobId,
    delay,
    priority: 1,
  };

  const job = await emailQueue.add('send-email', payload, options);
  logger.info(
    { jobId: job.id, emailJobId: payload.emailJobId, recipient: payload.recipientEmail, delayMs: delay },
    'Added delayed BullMQ email job'
  );

  return job.id || jobId;
}
