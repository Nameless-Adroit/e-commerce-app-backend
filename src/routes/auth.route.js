import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateToken, authorize } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rate-limit.middleware.js';
import { 
  validateLoginPayload, 
  validatePinPayload, 
  validateProfileUpdate 
} from '../middleware/validation.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// Public Authentication & Token Rotation Endpoints
// -----------------------------------------------------------------------------
// Unified Login: Phone + PIN
router.post('/login', authRateLimiter, validateLoginPayload, authController.login);

// New Business & Business Owner Onboarding Registration
router.post('/register-business', authRateLimiter, authController.registerBusiness);

// Refresh Access Token: Rotates 7-day Refresh Token and issues 15-minute Access Token
router.post('/refresh', authRateLimiter, authController.refresh);

// -----------------------------------------------------------------------------
// Protected Session Management & Logout
// -----------------------------------------------------------------------------
// Revoke current session & clear HTTP-only cookie
router.post('/logout', authenticateToken, authController.logout);

// Revoke all active sessions across all devices for current user
router.post('/logout-all', authenticateToken, authController.logoutAll);

// List all active sessions for current user (device, IP, activity)
router.get('/sessions', authenticateToken, authController.getSessions);

// Revoke a specific session belonging to current user
router.delete('/sessions/:sessionId', authenticateToken, authController.revokeUserSession);

// -----------------------------------------------------------------------------
// Protected User Profile & PIN Self-Service
// -----------------------------------------------------------------------------
// Get current user profile
router.get('/profile', authenticateToken, authController.getProfile);

// Update own profile (name, phone, profile image)
router.put('/profile', authenticateToken, validateProfileUpdate, authController.updateProfile);

// Set or update staff PIN
router.post('/pin', authenticateToken, validatePinPayload, authController.setPin);

// -----------------------------------------------------------------------------
// Administrative User Management (Super Admin & Shop Admin)
// -----------------------------------------------------------------------------
// List users
router.get(
  '/users',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.listUsers
);

// Register new user (Super Admin creates Admins/Sellers; Admin creates Sellers)
router.post(
  '/users',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.registerUser
);

// Super Admin or Admin updates user details (name, phone, role, shop, image, pin)
router.put(
  '/users/:id',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  validateProfileUpdate,
  authController.updateUser
);

// Suspend or reactivate user account
router.put(
  '/users/:id/status',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  authController.setUserStatus
);

export default router;
