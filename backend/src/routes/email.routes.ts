import { Router } from 'express';
import {
  getScheduledEmails,
  getSentEmails,
  getEmailById,
  searchEmails,
  testSendEmail,
  getSmtpDiagnosticsHandler,
} from '../controllers/email.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/scheduled', getScheduledEmails);
router.get('/sent', getSentEmails);
router.get('/search', searchEmails);
// GET /api/emails/smtp-diagnostic — returns safe diagnostic metadata (no email sent, no credentials leaked)
router.get('/smtp-diagnostic', getSmtpDiagnosticsHandler);
// POST /api/emails/test-send — sends test email to authenticated user's own address
router.post('/test-send', testSendEmail);
// Parameterised route last to avoid matching 'scheduled', 'sent', etc.
router.get('/:id', getEmailById);

export default router;
