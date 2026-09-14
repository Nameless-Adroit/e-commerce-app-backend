import express from 'express';
import * as posController from '../controllers/pos.controller.js';
import { authenticateToken, authorize, enforceShopScope } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// All POS routes require authentication and shop scoping
router.use(authenticateToken);
router.use(enforceShopScope);

// 1. Scan product ID using camera / barcode reader (SRS 3.3)
router.get(
  '/scan/:id',
  authorize([ROLES.SELLER, ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  posController.scanProduct
);

// 2. Checkout transaction and deduct units (SRS 3.3)
router.post(
  '/checkout',
  authorize([ROLES.SELLER, ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  posController.checkout
);

// 3. Transaction history
router.get(
  '/transactions',
  authorize([ROLES.SELLER, ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  posController.getTransactionHistory
);

// 4. Transaction details
router.get(
  '/transactions/:id',
  authorize([ROLES.SELLER, ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  posController.getTransactionById
);

export default router;
