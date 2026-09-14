import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateToken, authorize } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public: Unified Login Portal
router.post('/login', authController.login);

// Protected: Get current user profile
router.get('/profile', authenticateToken, authController.getProfile);

// Protected: Register new user (Super Admin can create any; Admin can create Sellers)
router.post(
  '/users',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.registerUser
);

export default router;
