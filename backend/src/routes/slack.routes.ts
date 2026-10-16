import { Router } from 'express';
import {
  slackAuth,
  slackCallback,
  getSlackStatus,
  disconnectSlack,
  testSlackMessage,
} from '../controllers/slack.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/auth', requireAuth, slackAuth);
router.get('/callback', slackCallback);
router.get('/status', requireAuth, getSlackStatus);
router.post('/disconnect', requireAuth, disconnectSlack);
router.post('/test', requireAuth, testSlackMessage);

export default router;
