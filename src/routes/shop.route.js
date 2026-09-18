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

// 2. Create new shop (Super Admin for any business, Admin for own business)
router.post(
  '/',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  shopController.createShop
);

// 3. Get shop details (Scoped to business / shop)
router.get(
  '/:id',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SELLER]),
  shopController.getShopById
);

export default router;
