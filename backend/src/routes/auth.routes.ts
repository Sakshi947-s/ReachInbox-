import { Router } from 'express';
import {
  googleAuth,
  googleCallback,
  getMe,
  logout,
  devLogin,
  getAuthStatus,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);
router.get('/me', requireAuth, getMe);
router.post('/logout', logout);

// Returns which integrations are configured (no secrets exposed)
// Safe to call unauthenticated — used by UI to show setup warnings
router.get('/status', getAuthStatus);

// Evaluation / Dev login helper — disabled in production (see auth.controller.ts)
router.post('/dev-login', devLogin);

export default router;
