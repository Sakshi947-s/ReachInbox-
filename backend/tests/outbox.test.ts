import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../src/config/prisma.js';
import { outboxService, MAX_OUTBOX_RETRIES } from '../src/services/outbox.service.js';
import { OutboxStatus } from '@prisma/client';
import * as esClient from '../src/integrations/elasticsearch/client.js';

describe('Transactional Outbox Service & Safe Reconciliation', () => {
  let testUserId: string;
  let testSenderId: string;
  let testCampaignId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        googleId: `outbox-test-user-${Date.now()}`,
        name: 'Outbox Tester',
        email: `outbox.tester.${Date.now()}@reachinbox.ai`,
      },
    });
    testUserId = user.id;

    const sender = await prisma.sender.create({
      data: {
        ownerId: user.id,
        displayName: 'Outbox Sender',
        email: `sender.${Date.now()}@reachinbox.ai`,
        isDefault: true,
      },
    });
    testSenderId = sender.id;

    const campaign = await prisma.campaign.create({
      data: {
        id: uuidv4(),
        ownerId: user.id,
        subject: 'Outbox Test Campaign',
        body: '<p>Outbox test body</p>',
        startTime: new Date(),
        status: 'SCHEDULED',
        totalRecipients: 1,
      },
    });
    testCampaignId = campaign.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (testUserId) {
      await prisma.campaign.deleteMany({ where: { ownerId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  it('successfully indexes an existing EmailJob and marks it esIndexed=true and outbox event PUBLISHED', async () => {
    const emailJobId = uuidv4();
    const emailJob = await prisma.emailJob.create({
      data: {
        id: emailJobId,
        campaignId: testCampaignId,
        ownerId: testUserId,
        senderId: testSenderId,
        recipientEmail: 'existing.recipient@example.com',
        subjectSnapshot: 'Test Subject',
        bodySnapshot: '<p>Body</p>',
        scheduledAt: new Date(),
        status: 'SENT',
        idempotencyKey: `idemp_${emailJobId}`,
        esIndexed: false,
      },
    });

    const outboxEvent = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'EMAIL_JOB',
        aggregateId: emailJob.id,
        eventType: 'INDEX_EMAIL_ES',
        payload: {
          id: emailJob.id,
          recipientEmail: emailJob.recipientEmail,
          subject: emailJob.subjectSnapshot,
          body: emailJob.bodySnapshot,
          status: 'SENT',
          ownerId: testUserId,
          campaignId: testCampaignId,
          senderEmail: 'sender@reachinbox.ai',
          scheduledAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        status: OutboxStatus.PENDING,
        retryCount: 0,
      },
    });

    // Mock Elasticsearch client calls
    vi.spyOn(esClient, 'isElasticsearchAvailable').mockReturnValue(true);
    vi.spyOn(esClient, 'indexEmailDocument').mockResolvedValue(true);

    const success = await outboxService.processEvent(outboxEvent);
    expect(success).toBe(true);

    // Verify EmailJob is marked esIndexed = true
    const updatedJob = await prisma.emailJob.findUnique({ where: { id: emailJob.id } });
    expect(updatedJob?.esIndexed).toBe(true);

    // Verify OutboxEvent is marked PUBLISHED
    const updatedEvent = await prisma.outboxEvent.findUnique({ where: { id: outboxEvent.id } });
    expect(updatedEvent?.status).toBe(OutboxStatus.PUBLISHED);

    // Clean up test records
    await prisma.outboxEvent.delete({ where: { id: outboxEvent.id } });
    await prisma.emailJob.delete({ where: { id: emailJob.id } });
  });

  it('safely handles missing EmailJob without throwing P2025, increments retryCount and transitions to FAILED when limit is reached', async () => {
    const nonExistentEmailJobId = uuidv4();

    // Event with retryCount = 4 (attempt 5 should reach limit 5)
    const outboxEvent = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'EMAIL_JOB',
        aggregateId: nonExistentEmailJobId,
        eventType: 'INDEX_EMAIL_ES',
        payload: {
          id: nonExistentEmailJobId,
          recipientEmail: 'orphan@example.com',
          subject: 'Orphan Subject',
        },
        status: OutboxStatus.PENDING,
        retryCount: 4,
      },
    });

    vi.spyOn(esClient, 'isElasticsearchAvailable').mockReturnValue(true);

    // Process event: MUST NOT THROW P2025
    let errorThrown: any = null;
    let result = false;
    try {
      result = await outboxService.processEvent(outboxEvent);
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeNull();
    expect(result).toBe(false);

    // Verify OutboxEvent transitioned to FAILED (dead-letter) and retryCount incremented to 5
    const updatedEvent = await prisma.outboxEvent.findUnique({ where: { id: outboxEvent.id } });
    expect(updatedEvent?.status).toBe(OutboxStatus.FAILED);
    expect(updatedEvent?.retryCount).toBe(5);

    // Clean up
    await prisma.outboxEvent.delete({ where: { id: outboxEvent.id } });
  });

  it('missing EmailJob below retry limit increments retryCount and remains PENDING', async () => {
    const nonExistentJobId = uuidv4();

    const outboxEvent = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'EMAIL_JOB',
        aggregateId: nonExistentJobId,
        eventType: 'INDEX_EMAIL_ES',
        payload: {
          id: nonExistentJobId,
          recipientEmail: 'orphan.pending@example.com',
        },
        status: OutboxStatus.PENDING,
        retryCount: 1,
      },
    });

    vi.spyOn(esClient, 'isElasticsearchAvailable').mockReturnValue(true);

    const result = await outboxService.processEvent(outboxEvent);
    expect(result).toBe(false);

    const updatedEvent = await prisma.outboxEvent.findUnique({ where: { id: outboxEvent.id } });
    expect(updatedEvent?.status).toBe(OutboxStatus.PENDING);
    expect(updatedEvent?.retryCount).toBe(2);

    // Clean up
    await prisma.outboxEvent.delete({ where: { id: outboxEvent.id } });
  });

  it('duplicate event processing is safe and returns true for already PUBLISHED events', async () => {
    const alreadyPublishedEvent = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'EMAIL_JOB',
        aggregateId: uuidv4(),
        eventType: 'INDEX_EMAIL_ES',
        payload: { id: uuidv4() },
        status: OutboxStatus.PUBLISHED,
        retryCount: 0,
      },
    });

    const result = await outboxService.processEvent(alreadyPublishedEvent);
    expect(result).toBe(true);

    const eventInDb = await prisma.outboxEvent.findUnique({ where: { id: alreadyPublishedEvent.id } });
    expect(eventInDb?.status).toBe(OutboxStatus.PUBLISHED);

    // Clean up
    await prisma.outboxEvent.delete({ where: { id: alreadyPublishedEvent.id } });
  });

  it('reconcileOutbox self-heals stale pending events with retryCount >= MAX_RETRIES to FAILED', async () => {
    const staleEvent = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'EMAIL_JOB',
        aggregateId: uuidv4(),
        eventType: 'INDEX_EMAIL_ES',
        payload: { id: uuidv4() },
        status: OutboxStatus.PENDING,
        retryCount: 5,
      },
    });

    await outboxService.reconcileOutbox();

    const healedEvent = await prisma.outboxEvent.findUnique({ where: { id: staleEvent.id } });
    expect(healedEvent?.status).toBe(OutboxStatus.FAILED);

    // Clean up
    await prisma.outboxEvent.delete({ where: { id: staleEvent.id } });
  });
});
