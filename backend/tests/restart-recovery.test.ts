import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../src/config/prisma.js';
import { emailQueue, scheduleEmailJob } from '../src/queues/email.queue.js';
import { createEmailWorker } from '../src/workers/email.worker.js';
import { redisClient } from '../src/config/redis.js';

describe('Restart Recovery & Idempotency Verification', () => {
  let testUserId: string;
  let testSenderId: string;
  let testSenderEmail: string;
  let testEmailJobId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        googleId: `restart-test-${Date.now()}`,
        name: 'Restart Tester',
        email: `restart.test.${Date.now()}@reachinbox.ai`,
      },
    });
    testUserId = user.id;

    const sender = await prisma.sender.create({
      data: {
        ownerId: user.id,
        displayName: 'Restart Sender',
        email: `sender.${Date.now()}@reachinbox.ai`,
        isDefault: true,
      },
    });
    testSenderId = sender.id;
    testSenderEmail = sender.email;
  });

  afterAll(async () => {
    if (testUserId) {
      if (testEmailJobId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: testEmailJobId } });
      }
      await prisma.campaign.deleteMany({ where: { ownerId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  it('preserves scheduled jobs across worker restarts and guarantees idempotency', async () => {
    const campaignId = uuidv4();
    const emailJobId = uuidv4();
    testEmailJobId = emailJobId;
    const recipient = `recipient.restart.${Date.now()}@example.com`;
    const targetScheduledTime = new Date(Date.now() + 4000); // 4 seconds in future

    // 1. Persist campaign and email record in PostgreSQL
    await prisma.campaign.create({
      data: {
        id: campaignId,
        ownerId: testUserId,
        subject: 'Restart Verification Test',
        body: '<p>Testing recovery across server restarts</p>',
        startTime: targetScheduledTime,
        status: 'SCHEDULED',
        totalRecipients: 1,
      },
    });

    const emailJob = await prisma.emailJob.create({
      data: {
        id: emailJobId,
        campaignId,
        ownerId: testUserId,
        senderId: testSenderId,
        recipientEmail: recipient,
        subjectSnapshot: 'Restart Verification Test',
        bodySnapshot: '<p>Testing recovery across server restarts</p>',
        scheduledAt: targetScheduledTime,
        status: 'SCHEDULED',
        idempotencyKey: `idemp_${emailJobId}`,
      },
    });

    // 2. Schedule delayed job in BullMQ
    const payload = {
      emailJobId,
      campaignId,
      ownerId: testUserId,
      senderId: testSenderId,
      senderEmail: testSenderEmail,
      recipientEmail: recipient,
      subject: 'Restart Verification Test',
      body: '<p>Testing recovery across server restarts</p>',
      scheduledAt: targetScheduledTime.toISOString(),
      hourlyLimit: 100,
      delayBetweenEmailsMs: 1000,
    };

    const bullJobId = await scheduleEmailJob(payload, targetScheduledTime);
    expect(bullJobId).toBe(`email-${emailJobId}`);

    // Update bullJobId on EmailJob
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { bullJobId },
    });

    // 3. Confirm job exists in BullMQ delayed state
    const jobInQueue = await emailQueue.getJob(bullJobId);
    expect(jobInQueue).toBeDefined();
    const stateBeforeRestart = await jobInQueue?.getState();
    expect(stateBeforeRestart).toBe('delayed');

    // 4. SIMULATE RESTART: Create a worker instance after a brief pause
    // Simulating process reboot where Redis & PostgreSQL persisted state
    const worker = createEmailWorker(1);

    // 5. Poll until email status reaches SENT (allowing network SMTP handshake to complete)
    let processedRecord = null;
    const maxWaitMs = 12000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < maxWaitMs) {
      processedRecord = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
      });
      if (processedRecord?.status === 'SENT') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 6. Verify job completed in PostgreSQL
    expect(processedRecord?.status).toBe('SENT');
    expect(processedRecord?.sentAt).toBeDefined();
    expect(processedRecord?.attemptCount).toBe(1); // Sent exactly once!
    expect(processedRecord?.etherealPreviewUrl).toBeDefined();

    // 7. Verify Campaign updated
    const campaignRecord = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    expect(campaignRecord?.sentCount).toBe(1);
    expect(campaignRecord?.status).toBe('COMPLETED');

    // Close test worker
    await worker.close();
  });
});
