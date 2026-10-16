import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { redisClient } from '../config/redis.js';
import { EmailJobPayload, scheduleEmailJob } from '../queues/email.queue.js';
import { indexEmailDocument, EmailDocument, isElasticsearchAvailable } from '../integrations/elasticsearch/client.js';

export const MAX_OUTBOX_RETRIES = 5;

export class OutboxService {
  private isReconciling = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  /**
   * Safely updates an OutboxEvent's retry count and dead-letter status upon failure.
   * Ensures that any error during the outbox update cannot mask the original error.
   */
  private async handleEventFailure(event: OutboxEvent, originalError: any): Promise<void> {
    logger.error(
      {
        originalError: originalError?.message || originalError,
        eventId: event.id,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        currentRetryCount: event.retryCount,
      },
      'Outbox event processing failed'
    );

    try {
      const nextRetryCount = event.retryCount + 1;
      const newStatus = nextRetryCount >= MAX_OUTBOX_RETRIES ? OutboxStatus.FAILED : OutboxStatus.PENDING;

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          retryCount: { increment: 1 },
          status: newStatus,
        },
      });

      if (newStatus === OutboxStatus.FAILED) {
        logger.warn(
          { eventId: event.id, retryCount: nextRetryCount, maxRetries: MAX_OUTBOX_RETRIES },
          'Outbox event exceeded maximum retries; transitioned to FAILED (dead-letter)'
        );
      }
    } catch (updateError) {
      // Critical: Ensure the update failure cannot mask or hide the original error
      logger.error(
        {
          originalError: originalError?.message || originalError,
          updateError: (updateError as any)?.message || updateError,
          eventId: event.id,
        },
        'CRITICAL: Failed to update OutboxEvent status after processing error'
      );
    }
  }

  /**
   * Processes a single OutboxEvent safely and idempotently.
   */
  public async processEvent(event: OutboxEvent): Promise<boolean> {
    // 1. Idempotency check: If already PUBLISHED, return true immediately
    if (event.status === OutboxStatus.PUBLISHED) {
      logger.debug({ eventId: event.id }, 'Outbox event is already PUBLISHED; skipping');
      return true;
    }

    try {
      // -------------------------------------------------------------
      // Event Type: SCHEDULE_EMAIL
      // -------------------------------------------------------------
      if (event.eventType === 'SCHEDULE_EMAIL') {
        const payload = event.payload as unknown as {
          emailJobPayload: EmailJobPayload;
          scheduledAt: string;
        };

        const emailJobId = payload?.emailJobPayload?.emailJobId || event.aggregateId;

        // Verify underlying EmailJob exists
        const emailJob = await prisma.emailJob.findUnique({
          where: { id: emailJobId },
          select: { id: true, status: true, bullJobId: true },
        });

        if (!emailJob) {
          logger.warn(
            { eventId: event.id, emailJobId, retryCount: event.retryCount },
            `EmailJob not found for SCHEDULE_EMAIL event; handling orphaned outbox event (attempt ${event.retryCount + 1}/${MAX_OUTBOX_RETRIES})`
          );
          await this.handleEventFailure(event, new Error(`EmailJob not found: ${emailJobId}`));
          return false;
        }

        const scheduledDate = new Date(payload.scheduledAt);
        const bullJobId = await scheduleEmailJob(payload.emailJobPayload, scheduledDate);

        // Update database EmailJob and OutboxEvent atomically
        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: emailJobId },
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

      // -------------------------------------------------------------
      // Event Type: INDEX_EMAIL_ES
      // -------------------------------------------------------------
      if (event.eventType === 'INDEX_EMAIL_ES') {
        const doc = event.payload as unknown as EmailDocument;
        const emailJobId = doc?.id || event.aggregateId;

        if (!emailJobId) {
          logger.warn(
            { eventId: event.id, aggregateId: event.aggregateId },
            'INDEX_EMAIL_ES event is missing an emailJobId'
          );
          await this.handleEventFailure(event, new Error('Missing emailJobId in INDEX_EMAIL_ES event'));
          return false;
        }

        // 1. Verify underlying EmailJob exists in PostgreSQL
        const emailJob = await prisma.emailJob.findUnique({
          where: { id: emailJobId },
          select: { id: true, esIndexed: true },
        });

        if (!emailJob) {
          // The EmailJob does NOT exist.
          // Do not repeatedly throw P2025. Log a clear warning and handle according to retry/dead-letter policy.
          logger.warn(
            { eventId: event.id, aggregateId: event.aggregateId, emailJobId, retryCount: event.retryCount },
            `EmailJob record not found for INDEX_EMAIL_ES event; handling orphaned outbox event (attempt ${event.retryCount + 1}/${MAX_OUTBOX_RETRIES})`
          );
          await this.handleEventFailure(event, new Error(`EmailJob not found: ${emailJobId}`));
          return false;
        }

        // 2. Check Elasticsearch availability
        if (!isElasticsearchAvailable()) {
          // Elasticsearch is not running right now; leave pending without counting as a failure
          logger.debug({ eventId: event.id, emailJobId }, 'Elasticsearch is unavailable; leaving outbox event pending');
          return false;
        }

        // 3. Index document into Elasticsearch
        const success = await indexEmailDocument(doc);
        if (!success) {
          logger.warn({ eventId: event.id, emailJobId }, 'indexEmailDocument returned false; scheduling retry');
          await this.handleEventFailure(event, new Error('Elasticsearch indexing failed'));
          return false;
        }

        // 4. Update EmailJob and OutboxEvent atomically
        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: emailJobId },
            data: { esIndexed: true },
          }),
          prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: OutboxStatus.PUBLISHED },
          }),
        ]);

        logger.info({ eventId: event.id, emailJobId }, 'Outbox INDEX_EMAIL_ES event processed and published successfully');
        return true;
      }

      // -------------------------------------------------------------
      // Unknown Event Type fallback
      // -------------------------------------------------------------
      logger.warn({ eventId: event.id, eventType: event.eventType }, 'Unknown event type encountered in OutboxEvent; marking as PUBLISHED');
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED },
      });
      return true;
    } catch (error) {
      await this.handleEventFailure(event, error);
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
      // 1. Dead-letter any stale events that already exceeded MAX_OUTBOX_RETRIES but remained PENDING
      await prisma.outboxEvent.updateMany({
        where: {
          status: OutboxStatus.PENDING,
          retryCount: { gte: MAX_OUTBOX_RETRIES },
        },
        data: {
          status: OutboxStatus.FAILED,
        },
      });

      // 2. Query pending events within the retry limit
      const pendingEvents = await prisma.outboxEvent.findMany({
        where: {
          status: OutboxStatus.PENDING,
          retryCount: { lt: MAX_OUTBOX_RETRIES },
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
