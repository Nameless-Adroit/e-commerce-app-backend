import express from 'express';
import * as analyticsController from '../controllers/analyticsController.js';
import { authenticateToken, authorize, enforceShopScope } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Analytics requires authentication and is accessible only to Admins and Super Admins (SRS 3.4)
router.use(authenticateToken);
router.use(enforceShopScope);

// 1. Get daily report (SRS 3.4)
router.get(
  '/daily',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  analyticsController.getDailyReport
);

// 2. Trigger end-of-day report compilation (SRS 3.4)
router.post(
  '/daily/close',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  analyticsController.triggerDailyClose
);

// 3. Get historical report range
router.get(
  '/range',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  analyticsController.getReportRange
);

export default router;
