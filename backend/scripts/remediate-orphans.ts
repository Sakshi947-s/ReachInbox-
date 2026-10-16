import { prisma } from '../src/config/prisma.js';
import { logger } from '../src/config/logger.js';
import { OutboxStatus } from '@prisma/client';

export async function remediateOrphanedOutboxEvents(): Promise<{
  inspectedCount: number;
  remediatedCount: number;
  remediatedIds: string[];
}> {
  logger.info('Starting explicit safe remediation of orphaned OutboxEvent records...');

  // 1. Find all pending events that have reached or exceeded max retries (5)
  const candidateEvents = await prisma.outboxEvent.findMany({
    where: {
      status: OutboxStatus.PENDING,
      retryCount: { gte: 5 },
    },
    orderBy: { createdAt: 'asc' },
  });

  logger.info({ count: candidateEvents.length }, 'Found candidate exhausted OutboxEvent records');

  const remediatedIds: string[] = [];

  for (const event of candidateEvents) {
    const payload = event.payload as any;
    const emailJobId = payload?.id || payload?.emailJobPayload?.emailJobId || event.aggregateId;

    // Verify whether the EmailJob exists
    const emailJob = await prisma.emailJob.findUnique({
      where: { id: emailJobId },
      select: { id: true },
    });

    if (!emailJob) {
      logger.info(
        {
          eventId: event.id,
          aggregateId: event.aggregateId,
          emailJobId,
          eventType: event.eventType,
          retryCount: event.retryCount,
        },
        'Safely transitioning exhausted orphaned OutboxEvent from PENDING to FAILED (dead-letter)'
      );

      // Explicitly update status to FAILED without deleting the record
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxStatus.FAILED,
        },
      });

      remediatedIds.push(event.id);
    } else {
      logger.warn(
        { eventId: event.id, emailJobId },
        'EmailJob actually exists; leaving event untouched for normal reconciliation'
      );
    }
  }

  logger.info(
    { remediatedCount: remediatedIds.length, remediatedIds },
    'Completed safe remediation of orphaned OutboxEvents'
  );

  return {
    inspectedCount: candidateEvents.length,
    remediatedCount: remediatedIds.length,
    remediatedIds,
  };
}

if (process.argv[1]?.includes('remediate-orphans')) {
  remediateOrphanedOutboxEvents()
    .then((res) => {
      console.log('Remediation Result:', JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('Remediation error:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
