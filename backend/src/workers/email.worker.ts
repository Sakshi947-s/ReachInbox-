import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { createRedisConnection } from '../config/redis.js';
import { EMAIL_QUEUE_NAME, EmailJobPayload, emailQueue } from '../queues/email.queue.js';
import { sendEmail } from '../integrations/email/smtp.js';
import { rateLimiterService } from '../services/rate-limiter.service.js';
import { sendSlackRateLimitNotification, sendSlackCampaignCompletionNotification } from '../integrations/slack/client.js';
import { indexEmailDocument, isElasticsearchAvailable } from '../integrations/elasticsearch/client.js';

export function createEmailWorker(concurrency: number = env.WORKER_CONCURRENCY): Worker<EmailJobPayload> {
  const workerRedisConnection = createRedisConnection('worker');

  logger.info({ concurrency, queue: EMAIL_QUEUE_NAME }, 'Initializing BullMQ Email Worker');

  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      const {
        emailJobId,
        campaignId,
        ownerId,
        senderEmail,
        recipientEmail,
        subject,
        body,
        hourlyLimit,
        delayBetweenEmailsMs,
      } = job.data;

      logger.info(
        { jobId: job.id, emailJobId, recipientEmail, attempt: job.attemptsMade + 1 },
        'Processing email job'
      );

      // 1. Concurrency-safe atomic check & state transition:
      // Only transition to PROCESSING if status is SCHEDULED or QUEUED
      const updated = await prisma.emailJob.updateMany({
        where: {
          id: emailJobId,
          status: { in: ['SCHEDULED', 'QUEUED'] },
        },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        const currentRecord = await prisma.emailJob.findUnique({ where: { id: emailJobId } });
        logger.warn(
          { emailJobId, currentStatus: currentRecord?.status },
          'EmailJob already processed or not in schedulable state; skipping'
        );
        return;
      }

      // Update campaign status to IN_PROGRESS if not already
      await prisma.campaign.updateMany({
        where: { id: campaignId, status: 'SCHEDULED' },
        data: { status: 'IN_PROGRESS' },
      });

      // 2. Check Distributed Hourly Rate Limit
      const rateLimitResult = await rateLimiterService.reserveHourlyQuota(senderEmail, hourlyLimit);

      if (!rateLimitResult.allowed) {
        logger.warn(
          {
            emailJobId,
            senderEmail,
            window: rateLimitResult.quotaWindowKey,
            rescheduleAt: rateLimitResult.nextEligibleTime.toISOString(),
          },
          'Hourly rate limit hit. Rescheduling job and sending notification.'
        );

        // Revert status to SCHEDULED and update scheduledAt in database
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'SCHEDULED',
            scheduledAt: rateLimitResult.nextEligibleTime,
            errorMessage: `Hourly quota limit (${rateLimitResult.hourlyLimit}/hr) reached. Rescheduled to next hour.`,
          },
        });

        // Trigger Slack rate-limit notification (deduplicated per sender & window)
        sendSlackRateLimitNotification({
          ownerId,
          senderEmail,
          hourlyLimit: rateLimitResult.hourlyLimit,
          quotaWindowKey: rateLimitResult.quotaWindowKey,
          nextEligibleTime: rateLimitResult.nextEligibleTime,
        }).catch((err) => {
          logger.error({ err }, 'Error in Slack rate-limit alert handler');
        });

        // Add delayed job in BullMQ for next window
        const reschedJobId = `email-${emailJobId}-resched-${rateLimitResult.quotaWindowKey}`;
        await emailQueue.add('send-email', job.data, {
          jobId: reschedJobId,
          delay: rateLimitResult.retryAfterMs,
          priority: 2, // High priority once rescheduled
        });

        return { rescheduled: true, nextEligibleTime: rateLimitResult.nextEligibleTime };
      }

      // 3. Enforce Concurrency-Safe Minimum Inter-Email Delay
      await rateLimiterService.coordinateMinDelay(senderEmail, delayBetweenEmailsMs);

      // 4. Send Email via Ethereal SMTP
      try {
        const sendResult = await sendEmail({
          from: senderEmail,
          to: recipientEmail,
          subject,
          html: body,
        });

        const sentAt = new Date();

        // 5. Update Database Record as SENT
        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: emailJobId },
            data: {
              status: 'SENT',
              sentAt,
              // Only store a preview URL when the Ethereal transport is used
              etherealPreviewUrl:
                sendResult.provider === 'ethereal' && sendResult.previewUrl
                  ? String(sendResult.previewUrl)
                  : null,
              errorMessage: null,
            },
          }),
          prisma.campaign.update({
            where: { id: campaignId },
            data: { sentCount: { increment: 1 } },
          }),
        ]);

        logger.info(
          { emailJobId, recipientEmail, previewUrl: sendResult.previewUrl },
          'Email sent successfully and recorded in PostgreSQL'
        );

        // 6. Asynchronously index document into Elasticsearch
        const doc = {
          id: emailJobId,
          campaignId,
          ownerId,
          recipientEmail,
          subject,
          body,
          status: 'SENT',
          scheduledAt: job.data.scheduledAt,
          sentAt: sentAt.toISOString(),
          senderEmail,
          createdAt: new Date().toISOString(),
        };

        if (isElasticsearchAvailable()) {
          indexEmailDocument(doc)
            .then(async (indexed) => {
              if (indexed) {
                await prisma.emailJob.update({
                  where: { id: emailJobId },
                  data: { esIndexed: true },
                });
              }
            })
            .catch(() => {});
        } else {
          // Record an OutboxEvent for eventual consistency
          await prisma.outboxEvent.create({
            data: {
              aggregateType: 'EMAIL_JOB',
              aggregateId: emailJobId,
              eventType: 'INDEX_EMAIL_ES',
              payload: doc as any,
              status: 'PENDING',
            },
          });
        }

        // Check if all campaign emails are completed
        const pendingCount = await prisma.emailJob.count({
          where: {
            campaignId,
            status: { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] },
          },
        });

        if (pendingCount === 0) {
          const completedCampaign = await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: 'COMPLETED' },
          });
          logger.info({ campaignId }, 'Campaign completed all recipient deliveries');

          sendSlackCampaignCompletionNotification({
            campaignId,
            ownerId: completedCampaign.ownerId,
            name: completedCampaign.name,
            subject: completedCampaign.subject,
            totalRecipients: completedCampaign.totalRecipients,
            sentCount: completedCampaign.sentCount,
            failedCount: completedCampaign.failedCount,
            completedAt: new Date(),
          }).catch((err) => {
            logger.error({ err, campaignId }, 'Failed to dispatch Slack campaign completion notification (non-blocking)');
          });
        }

        return { success: true, previewUrl: sendResult.previewUrl };
      } catch (sendError: any) {
        logger.error({ sendError, emailJobId, recipientEmail }, 'SMTP sending error in worker');

        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 3);
        const newStatus = isFinalAttempt ? 'FAILED' : 'QUEUED';

        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: emailJobId },
            data: {
              status: newStatus,
              errorMessage: sendError?.message || 'SMTP delivery failure',
            },
          }),
          ...(isFinalAttempt
            ? [
                prisma.campaign.update({
                  where: { id: campaignId },
                  data: { failedCount: { increment: 1 } },
                }),
              ]
            : []),
        ]);

        if (isFinalAttempt) {
          const remainingPending = await prisma.emailJob.count({
            where: {
              campaignId,
              status: { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] },
            },
          });
          if (remainingPending === 0) {
            const completedCampaign = await prisma.campaign.update({
              where: { id: campaignId },
              data: { status: 'COMPLETED' },
            });
            sendSlackCampaignCompletionNotification({
              campaignId,
              ownerId: completedCampaign.ownerId,
              name: completedCampaign.name,
              subject: completedCampaign.subject,
              totalRecipients: completedCampaign.totalRecipients,
              sentCount: completedCampaign.sentCount,
              failedCount: completedCampaign.failedCount,
              completedAt: new Date(),
            }).catch((err) => {
              logger.error({ err, campaignId }, 'Failed to dispatch Slack campaign completion notification (non-blocking)');
            });
          }
        }

        throw sendError; // Re-throw so BullMQ triggers its exponential backoff
      }
    },
    {
      connection: workerRedisConnection,
      concurrency,
      limiter: {
        max: 50,
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Job completed successfully');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job failed');
  });

  return worker;
}
