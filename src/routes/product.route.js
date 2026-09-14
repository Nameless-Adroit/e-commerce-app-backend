import express from 'express';
import * as productController from '../controllers/product.controller.js';
import { authenticateToken, authorize, enforceShopScope } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// All product routes require authentication and shop scoping
router.use(authenticateToken);
router.use(enforceShopScope);

// 1. Generate unique alphanumeric Product ID (SRS 3.2)
router.post(
  '/generate-id',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.generateId
);

// 2. List products with filters, search, pagination
router.get(
  '/',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SELLER]),
  productController.listProducts
);

// 3. Create a new product with unique ID (SRS 3.2)
router.post(
  '/',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.createProduct
);

// 4. Scan / Lookup product by its unique alphanumeric ID
router.get(
  '/:id',
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SELLER]),
  productController.getProductById
);

// 5. Update price and details (SRS 3.2)
router.put(
  '/:id',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.updateProduct
);

// 6. Restock existing product (SRS 3.2 - Includes Customer Returns by Sellers)
router.post(
  '/:id/restock',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SELLER]),
  productController.restockProduct
);

// 7. Record inventory shrinkage / loss adjustment (SRS 3.4)
router.post(
  '/:id/shrinkage',
  authorize([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  productController.recordShrinkage
);

export default router;
