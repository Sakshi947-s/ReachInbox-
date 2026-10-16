import { Router } from 'express';
import multer from 'multer';
import {
  createCampaign,
  parseRecipientsEndpoint,
  getCampaigns,
  getCampaignById,
  cancelCampaign,
} from '../controllers/campaign.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const router = Router();

router.use(requireAuth);

router.post('/parse-recipients', upload.single('file'), parseRecipientsEndpoint);
router.post('/', upload.single('file'), createCampaign);
router.get('/', getCampaigns);
router.get('/:id', getCampaignById);
router.post('/:id/cancel', cancelCampaign);

export default router;
