import express from 'express';
import * as businessController from '../controllers/business.controller.js';
import { authenticateToken, authorize, enforceBusinessScope } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

router.use(authenticateToken);

// 1. Super Admin: List all businesses across system
router.get(
  '/',
  authorize([ROLES.SUPER_ADMIN]),
  businessController.listBusinesses
);

// 2. Super Admin: Create new Business
router.post(
  '/',
  authorize([ROLES.SUPER_ADMIN]),
  businessController.createBusiness
);

// 3. Admin / Super Admin: Get own business overview
router.get(
  '/my/overview',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  (req, res, next) => {
    req.targetBusinessId = req.user.business_id;
    businessController.getBusinessOverview(req, res, next);
  }
);

// 4. Admin / Super Admin: Get specific business details
router.get(
  '/:id',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  enforceBusinessScope,
  businessController.getBusiness
);

// 5. Admin / Super Admin: Update business details / currency
router.put(
  '/:id',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  enforceBusinessScope,
  businessController.updateBusiness
);

// 6. Admin / Super Admin: Business overview metrics
router.get(
  '/:id/overview',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  enforceBusinessScope,
  businessController.getBusinessOverview
);

export default router;
