import { Router } from 'express';
import {
  getScheduledEmails,
  getSentEmails,
  getEmailById,
  searchEmails,
} from '../controllers/email.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/scheduled', getScheduledEmails);
router.get('/sent', getSentEmails);
router.get('/search', searchEmails);
router.get('/:id', getEmailById);

export default router;
