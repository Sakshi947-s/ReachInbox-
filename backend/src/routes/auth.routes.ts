import { Router } from 'express';
import { googleAuth, googleCallback, getMe, logout, devLogin } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);
router.get('/me', requireAuth, getMe);
router.post('/logout', logout);

// Evaluation / Dev login helper
router.post('/dev-login', devLogin);

export default router;
