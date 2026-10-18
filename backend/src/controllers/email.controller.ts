import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { searchEmailsInES, isElasticsearchAvailable } from '../integrations/elasticsearch/client.js';
import { sendEmail, verifySmtpConfig, getSmtpProvider, getSmtpDiagnostics } from '../integrations/email/smtp.js';

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

/**
 * POST /api/emails/test-send
 * Sends a test email to the authenticated user's own email address.
 * Requires authentication. Never exposes credentials.
 * Returns: { success, provider, messageId, previewUrl, smtpVerified, from, to }
 */
export async function testSendEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    // 1. Verify SMTP connection first
    const verification = await verifySmtpConfig();
    if (!verification.ok) {
      res.status(502).json({
        success: false,
        provider: verification.provider,
        error: 'SMTP verification failed',
        details: verification.message,
        hint:
          verification.provider === 'ethereal'
            ? 'Ethereal requires internet access to generate a test account. Check your network.'
            : `Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in your .env file.`,
      });
      return;
    }

    const recipientEmail = req.user!.email;
    const fromEmail = req.user!.email;
    const provider = getSmtpProvider();

    // 2. Send the test email
    const result = await sendEmail({
      from: fromEmail,
      to: recipientEmail,
      subject: `ReachInbox SMTP Test — ${new Date().toISOString()}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #4f46e5;">ReachInbox SMTP Test</h2>
          <p>This confirms your SMTP configuration is working correctly.</p>
          <ul style="margin-top: 16px;">
            <li><strong>Provider:</strong> ${provider === 'real' ? 'Real SMTP' : 'Ethereal (test)'}</li>
            <li><strong>Sent to:</strong> ${recipientEmail}</li>
            <li><strong>Sent at:</strong> ${new Date().toISOString()}</li>
          </ul>
          <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">ReachInbox Email Job Scheduler</p>
        </div>
      `,
    });

    logger.info(
      { to: recipientEmail, provider: result.provider, messageId: result.messageId },
      'Test email sent successfully'
    );

    res.json({
      success: true,
      provider: result.provider,
      messageId: result.messageId,
      previewUrl: result.previewUrl || null,
      smtpVerified: true,
      from: fromEmail,
      to: recipientEmail,
      hint:
        result.previewUrl
          ? `Preview your test email at: ${result.previewUrl}`
          : result.provider === 'real'
          ? 'Email delivered. Check your inbox.'
          : null,
    });
  } catch (error: any) {
    logger.error({ error }, 'Test email send failed');
    res.status(502).json({
      success: false,
      provider: getSmtpProvider(),
      error: 'Failed to send test email',
      details: error?.message || 'Unknown SMTP error',
      hint:
        getSmtpProvider() === 'real'
          ? 'Verify SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS. For Gmail, use an App Password with 2FA enabled.'
          : 'Ethereal failed. Check internet connectivity.',
    });
  }
}

/**
 * GET /api/emails/smtp-diagnostic
 * Safe diagnostic that reports whether SMTP_PASS exists and its character count,
 * but NEVER logs or returns the password, username, or credentials.
 * Does not send any email.
 */
export async function getSmtpDiagnosticsHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const diagnostic = getSmtpDiagnostics();
  res.json({
    success: true,
    diagnostic,
  });
}
