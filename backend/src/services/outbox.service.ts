import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { redisClient } from '../config/redis.js';
import { EmailJobPayload, scheduleEmailJob } from '../queues/email.queue.js';
import { indexEmailDocument, EmailDocument, isElasticsearchAvailable } from '../integrations/elasticsearch/client.js';

export class OutboxService {
  private isReconciling = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  /**
   * Processes a single OutboxEvent safely.
   */
  public async processEvent(event: OutboxEvent): Promise<boolean> {
    try {
      if (event.eventType === 'SCHEDULE_EMAIL') {
        const payload = event.payload as unknown as {
          emailJobPayload: EmailJobPayload;
          scheduledAt: string;
        };

        const scheduledDate = new Date(payload.scheduledAt);
        const bullJobId = await scheduleEmailJob(payload.emailJobPayload, scheduledDate);

        // Update database EmailJob and OutboxEvent
        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: payload.emailJobPayload.emailJobId },
            data: { bullJobId, status: 'SCHEDULED' },
          }),
          prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: OutboxStatus.PUBLISHED },
          }),
        ]);

        logger.info({ eventId: event.id, bullJobId }, 'Outbox SCHEDULE_EMAIL event published successfully');
        return true;
      }

      if (event.eventType === 'INDEX_EMAIL_ES') {
        if (!isElasticsearchAvailable()) {
          // Elasticsearch is not running right now; leave pending without counting as failure
          return false;
        }
        const doc = event.payload as unknown as EmailDocument;
        const success = await indexEmailDocument(doc);
        if (success) {
          await prisma.$transaction([
            prisma.emailJob.update({
              where: { id: doc.id },
              data: { esIndexed: true },
            }),
            prisma.outboxEvent.update({
              where: { id: event.id },
              data: { status: OutboxStatus.PUBLISHED },
            }),
          ]);
          return true;
        }
        return false;
      }

      // Mark unknown events as published to avoid infinite loops
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED },
      });
      return true;
    } catch (error) {
      logger.error({ error, eventId: event.id }, 'Error processing outbox event');
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          retryCount: { increment: 1 },
          status: event.retryCount >= 5 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
        },
      });
      return false;
    }
  }

  /**
   * Reconciles unstrandable pending events in the transactional outbox.
   * Uses Redis distributed lock to avoid multi-instance concurrency.
   */
  public async reconcileOutbox(): Promise<number> {
    if (this.isReconciling) return 0;

    const lockKey = 'lock:outbox:reconciliation';
    const acquired = await redisClient.set(lockKey, 'locked', 'PX', 10000, 'NX');
    if (!acquired) {
      logger.debug('Outbox reconciliation already running on another instance');
      return 0;
    }

    this.isReconciling = true;
    let processedCount = 0;

    try {
      const pendingEvents = await prisma.outboxEvent.findMany({
        where: {
          status: OutboxStatus.PENDING,
          retryCount: { lt: 5 },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      if (pendingEvents.length > 0) {
        logger.debug({ count: pendingEvents.length }, 'Reconciling pending transactional outbox events');
      }

      for (const event of pendingEvents) {
        const success = await this.processEvent(event);
        if (success) processedCount++;
      }
    } catch (err) {
      logger.error({ err }, 'Error during outbox reconciliation');
    } finally {
      this.isReconciling = false;
      await redisClient.del(lockKey).catch(() => {});
    }

    return processedCount;
  }

  /**
   * Starts periodic reconciliation without any OS or node cron library.
   */
  public startBackgroundReconciliation(intervalMs = 15000): void {
    if (this.intervalHandle) return;
    logger.info({ intervalMs }, 'Starting transactional outbox background reconciliation runner');
    
    // Initial run
    this.reconcileOutbox().catch(() => {});

    this.intervalHandle = setInterval(() => {
      this.reconcileOutbox().catch(() => {});
    }, intervalMs);
  }

  public stopBackgroundReconciliation(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}

export const outboxService = new OutboxService();
