import express from 'express';
import * as posController from '../controllers/pos.controller.js';
import { authenticateToken, authorize, enforceShopScope } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// All POS routes require authentication and shop scoping
router.use(authenticateToken);
router.use(enforceShopScope);

// 1. Scan product ID using camera / barcode reader (SRS 3.3) - Sellers only
router.get(
  '/scan/:id',
  authorize([ROLES.SELLER]),
  posController.scanProduct
);

// 2. Checkout transaction and deduct units (SRS 3.3) - Sellers only
router.post(
  '/checkout',
  authorize([ROLES.SELLER]),
  posController.checkout
);

// 3. Process customer return transaction (Prompt Section 5) - Sellers only
router.post(
  '/return',
  authorize([ROLES.SELLER]),
  posController.processReturn
);

// 4. Transaction history
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
