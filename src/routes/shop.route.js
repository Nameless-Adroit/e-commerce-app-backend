import express from 'express';
import * as shopController from '../controllers/shop.controller.js';
import { authenticateToken, authorize } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Shop administration is restricted to Super Admin (platform overseer)
router.use(authenticateToken);

// 1. List shops (Super Admin sees all/filtered, Admin sees own business shops, Seller sees assigned shop)
router.get(
  '/',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SELLER]),
  shopController.getAllShops
);

// 2. Shop requests workflow
// Submit new shop request (Admin only)
router.post(
  '/requests',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  shopController.submitShopRequest
);

// List shop requests (Admin sees own business requests, Super Admin sees all)
router.get(
  '/requests',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  shopController.getShopRequests
);

// Approve shop request (Super Admin only)
router.post(
  '/requests/:id/approve',
  authorize([ROLES.SUPER_ADMIN]),
  shopController.approveShopRequest
);

// Reject shop request (Super Admin only)
router.post(
  '/requests/:id/reject',
  authorize([ROLES.SUPER_ADMIN]),
  shopController.rejectShopRequest
);

// 3. Direct create shop (Super Admin only)
router.post(
  '/',
  authorize([ROLES.SUPER_ADMIN]),
  shopController.createShop
);

// 4. Get shop details (Scoped to business / shop)
router.get(
  '/:id',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SELLER]),
  shopController.getShopById
);

export default router;

