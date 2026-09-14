import express from 'express';
import * as shopController from '../controllers/shop.controller.js';
import { authenticateToken, authorize } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Shop administration is restricted to Super Admin (platform overseer)
router.use(authenticateToken);

// 1. List all shops
router.get(
  '/',
  authorize([ROLES.SUPER_ADMIN]),
  shopController.getAllShops
);

// 2. Create new shop
router.post(
  '/',
  authorize([ROLES.SUPER_ADMIN]),
  shopController.createShop
);

// 3. Get shop details
router.get(
  '/:id',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  shopController.getShopById
);

export default router;
