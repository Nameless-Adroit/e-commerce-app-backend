import express from 'express';
import * as analyticsController from '../controllers/analytics.controller.js';
import { authenticateToken, authorize, enforceShopScope } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Analytics requires authentication and is accessible only to Admins and Super Admins (SRS 3.4)
router.use(authenticateToken);
router.use(enforceShopScope);

// 1. Get daily report (SRS 3.4)
router.get(
  '/daily',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SELLER]),
  analyticsController.getDailyReport
);

// 2. POS Seller: Reconcile daily transactions before closing
router.get(
  '/daily/reconcile',
  authorize([ROLES.SELLER, ROLES.SUPER_ADMIN]),
  analyticsController.getDailyReconciliation
);

// 3. POS Seller: Trigger end-of-day business closure (SRS 3.4)
router.post(
  '/daily/close',
  authorize([ROLES.SELLER, ROLES.SUPER_ADMIN]),
  analyticsController.triggerDailyClose
);

// 4. Shop Admin: Tabular Sales Report of products sold (Product Name, Category, Quantity Sold, Total Sales Volume/Revenue, Average Selling Price)
router.get(
  '/products-sold',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  analyticsController.getProductsSoldReport
);

// 5. Get historical report range
router.get(
  '/range',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  analyticsController.getReportRange
);

// 6. Get top-selling / most sold products (Accessible to Sellers, Admins, and Super Admins)
router.get(
  '/top-products',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SELLER]),
  analyticsController.getTopSellingProducts
);

export default router;
