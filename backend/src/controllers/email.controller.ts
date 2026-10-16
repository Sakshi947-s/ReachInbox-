import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { searchEmailsInES, isElasticsearchAvailable } from '../integrations/elasticsearch/client.js';

export async function getScheduledEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 15));
  const skip = (page - 1) * limit;
  const statusFilter = req.query.status as string;

  const validStatuses = ['SCHEDULED', 'QUEUED', 'PROCESSING'];
  const statusCondition = statusFilter && validStatuses.includes(statusFilter)
    ? statusFilter
    : { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] };

  try {
    const [emails, total] = await Promise.all([
      prisma.emailJob.findMany({
        where: {
          ownerId: req.user!.id,
          status: statusCondition as any,
        },
        include: {
          campaign: { select: { id: true, name: true, subject: true } },
          sender: { select: { email: true, displayName: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
      }),
      prisma.emailJob.count({
        where: {
          ownerId: req.user!.id,
          status: statusCondition as any,
        },
      }),
    ]);

    res.json({
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching scheduled emails');
    res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
}

export async function getSentEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 15));
  const skip = (page - 1) * limit;
  const statusFilter = req.query.status as string;

  const validStatuses = ['SENT', 'FAILED'];
  const statusCondition = statusFilter && validStatuses.includes(statusFilter)
    ? statusFilter
    : { in: ['SENT', 'FAILED'] };

  try {
    const [emails, total] = await Promise.all([
      prisma.emailJob.findMany({
        where: {
          ownerId: req.user!.id,
          status: statusCondition as any,
        },
        include: {
          campaign: { select: { id: true, name: true, subject: true } },
          sender: { select: { email: true, displayName: true } },
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailJob.count({
        where: {
          ownerId: req.user!.id,
          status: statusCondition as any,
        },
      }),
    ]);

    res.json({
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching sent emails');
    res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
}

export async function getEmailById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const email = await prisma.emailJob.findFirst({
      where: { id, ownerId: req.user!.id },
      include: {
        campaign: true,
        sender: { select: { email: true, displayName: true } },
      },
    });

    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    res.json({ email });
  } catch (error) {
    logger.error({ error }, 'Error fetching email by ID');
    res.status(500).json({ error: 'Failed to fetch email' });
  }
}

export async function searchEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const query = (req.query.q as string || '').trim();
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
  const status = req.query.status as string;

  try {
    // 1. Try searching with Elasticsearch if available
    if (isElasticsearchAvailable() && query.length > 0) {
      try {
        const esResult = await searchEmailsInES({
          ownerId: req.user!.id,
          query,
          status,
          page,
          limit,
        });

        res.json({
          source: 'elasticsearch',
          emails: esResult.hits,
          pagination: {
            page: esResult.page,
            limit: esResult.limit,
            total: esResult.total,
            totalPages: esResult.totalPages,
          },
        });
        return;
      } catch (esError) {
        logger.warn({ esError }, 'Elasticsearch search failed; falling back to PostgreSQL search');
      }
    }

    // 2. PostgreSQL Full-Text / ILIKE Fallback
    const skip = (page - 1) * limit;
    const whereClause: any = {
      ownerId: req.user!.id,
      ...(status ? { status: status as any } : {}),
      ...(query.length > 0
        ? {
            OR: [
              { recipientEmail: { contains: query, mode: 'insensitive' } },
              { subjectSnapshot: { contains: query, mode: 'insensitive' } },
              { bodySnapshot: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [emails, total] = await Promise.all([
      prisma.emailJob.findMany({
        where: whereClause,
        include: {
          campaign: { select: { id: true, name: true, subject: true } },
          sender: { select: { email: true, displayName: true } },
        },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailJob.count({ where: whereClause }),
    ]);

    res.json({
      source: 'postgresql',
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error searching emails');
    res.status(500).json({ error: 'Failed to search emails' });
  }
}
