import { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { parseRecipientsFromContent } from '../utils/csv.js';
import { outboxService } from '../services/outbox.service.js';
import { emailQueue } from '../queues/email.queue.js';

const createCampaignSchema = z.object({
  name: z.string().optional(),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  startTime: z.string().datetime({ message: 'startTime must be a valid ISO 8601 string' }),
  delayBetweenEmailsMs: z.coerce.number().min(0).default(2000),
  hourlyLimit: z.coerce.number().min(1).default(100),
  senderId: z.string().optional(),
  recipients: z.array(z.string().email()).optional(),
  csvContent: z.string().optional(),
  emailColumn: z.string().optional(),
});

export async function parseRecipientsEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    let content = '';

    if (req.file) {
      content = req.file.buffer.toString('utf8');
    } else if (req.body.csvContent) {
      content = req.body.csvContent;
    } else {
      res.status(400).json({ error: 'No file or csvContent provided' });
      return;
    }

    const requestedColumn = req.body.emailColumn;
    const result = parseRecipientsFromContent(content, requestedColumn);

    res.json({
      success: true,
      data: {
        validCount: result.validEmails.length,
        duplicateCount: result.duplicateEmails.length,
        invalidCount: result.invalidEmails.length,
        totalParsed: result.totalParsed,
        validSample: result.validEmails.slice(0, 50),
        invalidSample: result.invalidEmails.slice(0, 20),
        duplicateSample: result.duplicateEmails.slice(0, 20),
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Error parsing recipients file');
    res.status(500).json({ error: 'Failed to parse recipients', details: error.message });
  }
}

export async function createCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parseResult = createCampaignSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten(),
    });
    return;
  }

  const {
    name,
    subject,
    body,
    startTime: startTimeIso,
    delayBetweenEmailsMs,
    hourlyLimit,
    senderId: requestedSenderId,
    recipients: directRecipients,
    csvContent,
    emailColumn,
  } = parseResult.data;

  const ownerId = req.user!.id;

  try {
    // 1. Resolve recipients list
    let recipientList: string[] = [];

    if (directRecipients && directRecipients.length > 0) {
      // Deduplicate direct recipients
      recipientList = Array.from(new Set(directRecipients.map((r) => r.toLowerCase().trim())));
    } else if (csvContent || req.file) {
      const content = req.file ? req.file.buffer.toString('utf8') : csvContent || '';
      const parsed = parseRecipientsFromContent(content, emailColumn);
      recipientList = parsed.validEmails;
    }

    if (recipientList.length === 0) {
      res.status(400).json({
        error: 'No valid recipients',
        message: 'The campaign must have at least one valid email recipient.',
      });
      return;
    }

    // 2. Resolve sender
    let sender = null;
    if (requestedSenderId) {
      sender = await prisma.sender.findFirst({
        where: { id: requestedSenderId, ownerId, isActive: true },
      });
    }

    if (!sender) {
      sender = await prisma.sender.findFirst({
        where: { ownerId, isDefault: true, isActive: true },
      });
    }

    if (!sender) {
      sender = await prisma.sender.create({
        data: {
          ownerId,
          displayName: req.user!.name,
          email: req.user!.email,
          isDefault: true,
        },
      });
    }

    // 3. Time calculation
    const requestedStart = new Date(startTimeIso);
    const now = new Date();
    // If requested start time is in the past, clamp to current time
    const initialSendTime = requestedStart.getTime() < now.getTime() ? now : requestedStart;

    // Effective system limit check: campaign limit cannot exceed system configured max
    const effectiveHourlyLimit = Math.min(hourlyLimit, env.MAX_EMAILS_PER_HOUR_PER_SENDER);

    // 4. Atomic PostgreSQL Transaction: Create Campaign, EmailJobs, and OutboxEvents
    const campaignId = uuidv4();
    const emailJobRecords: any[] = [];
    const outboxRecords: any[] = [];

    let currentScheduledTime = new Date(initialSendTime);

    for (let i = 0; i < recipientList.length; i++) {
      const recipientEmail = recipientList[i];
      const emailJobId = uuidv4();
      const idempotencyKey = `camp_${campaignId}_${recipientEmail}`;

      // Calculate each email's staggered scheduled time using delayBetweenEmailsMs
      if (i > 0) {
        currentScheduledTime = new Date(currentScheduledTime.getTime() + delayBetweenEmailsMs);
      }

      emailJobRecords.push({
        id: emailJobId,
        campaignId,
        ownerId,
        senderId: sender.id,
        recipientEmail,
        subjectSnapshot: subject,
        bodySnapshot: body,
        scheduledAt: currentScheduledTime,
        status: 'SCHEDULED',
        idempotencyKey,
      });

      // Transactional Outbox Event for BullMQ dispatch
      outboxRecords.push({
        id: uuidv4(),
        aggregateType: 'EMAIL_JOB',
        aggregateId: emailJobId,
        eventType: 'SCHEDULE_EMAIL',
        payload: {
          emailJobPayload: {
            emailJobId,
            campaignId,
            ownerId,
            senderId: sender.id,
            senderEmail: sender.email,
            recipientEmail,
            subject,
            body,
            scheduledAt: currentScheduledTime.toISOString(),
            hourlyLimit: effectiveHourlyLimit,
            delayBetweenEmailsMs,
          },
          scheduledAt: currentScheduledTime.toISOString(),
        },
        status: 'PENDING',
        scheduledFor: currentScheduledTime,
      });
    }

    // Persist in Postgres atomically
    await prisma.$transaction(async (tx) => {
      await tx.campaign.create({
        data: {
          id: campaignId,
          ownerId,
          name: name || `Campaign ${new Date().toLocaleDateString()}`,
          subject,
          body,
          startTime: initialSendTime,
          delayBetweenEmailsMs,
          hourlyLimit: effectiveHourlyLimit,
          status: 'SCHEDULED',
          totalRecipients: recipientList.length,
        },
      });

      // Insert EmailJobs
      await tx.emailJob.createMany({
        data: emailJobRecords,
      });

      // Insert OutboxEvents
      await tx.outboxEvent.createMany({
        data: outboxRecords,
      });
    });

    logger.info(
      { campaignId, recipientCount: recipientList.length, startTime: initialSendTime.toISOString() },
      'Campaign created in PostgreSQL; dispatching outbox events to BullMQ'
    );

    // 5. Trigger immediate asynchronous Outbox dispatch to BullMQ
    outboxService.reconcileOutbox().catch((err) => {
      logger.error({ err }, 'Error in immediate outbox dispatch');
    });

    res.status(201).json({
      success: true,
      message: 'Campaign created and emails scheduled successfully',
      campaign: {
        id: campaignId,
        name: name || subject,
        subject,
        startTime: initialSendTime.toISOString(),
        delayBetweenEmailsMs,
        hourlyLimit: effectiveHourlyLimit,
        totalRecipients: recipientList.length,
        firstSendAt: initialSendTime.toISOString(),
        estimatedCompletionAt: currentScheduledTime.toISOString(),
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to create campaign');
    res.status(500).json({ error: 'Failed to create campaign', details: error.message });
  }
}

export async function getCampaigns(req: AuthenticatedRequest, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
  const skip = (page - 1) * limit;

  try {
    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where: { ownerId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaign.count({ where: { ownerId: req.user!.id } }),
    ]);

    res.json({
      campaigns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching campaigns');
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
}

export async function getCampaignById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user!.id },
      include: {
        emailJobs: {
          orderBy: { scheduledAt: 'asc' },
          take: 100,
        },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    res.json({ campaign });
  } catch (error) {
    logger.error({ error }, 'Error fetching campaign by ID');
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
}

export async function cancelCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: req.user!.id },
      include: {
        emailJobs: {
          where: { status: { in: ['SCHEDULED', 'QUEUED'] } },
        },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Cancel BullMQ jobs
    for (const job of campaign.emailJobs) {
      if (job.bullJobId) {
        try {
          const bullJob = await emailQueue.getJob(job.bullJobId);
          if (bullJob) {
            await bullJob.remove();
          }
        } catch (err) {
          logger.warn({ err, bullJobId: job.bullJobId }, 'Error removing BullMQ job during cancellation');
        }
      }
    }

    // Mark database records CANCELLED
    await prisma.$transaction([
      prisma.emailJob.updateMany({
        where: { campaignId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
        data: { status: 'CANCELLED' },
      }),
      prisma.campaign.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
    ]);

    logger.info({ campaignId: id }, 'Campaign cancelled successfully');
    res.json({ success: true, message: 'Campaign cancelled successfully' });
  } catch (error) {
    logger.error({ error }, 'Error cancelling campaign');
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
}
