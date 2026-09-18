import express from 'express';
import authRoute from './auth.route.js';
import productRoute from './product.route.js';
import posRoute from './pos.route.js';
import analyticsRoute from './analytics.route.js';
import shopRoute from './shop.route.js';
import businessRoute from './business.route.js';

const router = express.Router();

router.use('/auth', authRoute);
router.use('/businesses', businessRoute);
router.use('/products', productRoute);
router.use('/pos', posRoute);
router.use('/analytics', analyticsRoute);
router.use('/shops', shopRoute);

export default router;
