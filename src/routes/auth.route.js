import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateToken, authorize } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// Public: Unified Login Portal
router.post('/login', authController.login);

// Protected: Get current user profile
router.get('/profile', authenticateToken, authController.getProfile);

// Protected: Change password (for user changing initial or regular password)
router.post(
  '/change-password',
  authenticateToken,
  authController.changePassword
);

// Protected: List users (Super Admin or Admin)
router.get(
  '/users',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.listUsers
);

// Protected: Register new user (Super Admin creates Admins/Sellers; Admin creates Sellers)
router.post(
  '/users',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.registerUser
);

// Protected: Reset user credentials with temporary password (Super Admin or Admin)
router.post(
  '/users/:id/reset-password',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.resetPassword
);

// Protected: Suspend or reactivate user account (Super Admin or Admin)
router.put(
  '/users/:id/status',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.setUserStatus
);

export default router;
