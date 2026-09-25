/**
 * Subscription & Billing Routes
 */
import express from 'express';
import * as subscriptionController from '../controllers/subscription.controller.js';
import { 
  authenticateToken, 
  authorize, 
  requirePlatformOwner,
  enforceBusinessScope 
} from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// 1. Subscription Plans (Public list for registration & onboarding, Admin management)
// -----------------------------------------------------------------------------
// Public / Authenticated: List active plans
router.get('/plans', subscriptionController.listPlans);

// Get single plan
router.get('/plans/:id', subscriptionController.getPlan);

// Platform Owner: Create new plan
router.post(
  '/plans',
  authenticateToken,
  requirePlatformOwner,
  subscriptionController.createPlan
);

// Platform Owner: Update plan
router.put(
  '/plans/:id',
  authenticateToken,
  requirePlatformOwner,
  subscriptionController.updatePlan
);

// Platform Owner: Retire plan
router.put(
  '/plans/:id/retire',
  authenticateToken,
  requirePlatformOwner,
  subscriptionController.retirePlan
);

// -----------------------------------------------------------------------------
// 2. Business Owner Self-Service Billing
// -----------------------------------------------------------------------------
// Business Owner: Get own subscription, live days remaining, quota usage
router.get(
  '/my',
  authenticateToken,
  authorize([ROLES.ADMIN]),
  subscriptionController.getMySubscription
);

// Support both /my and /business endpoints for mobile client compatibility
router.get(
  '/business',
  authenticateToken,
  authorize([ROLES.ADMIN]),
  subscriptionController.getMySubscription
);

// Support /business/:businessId as alias for /:businessId
router.get(
  '/business/:businessId',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  enforceBusinessScope,
  subscriptionController.getBusinessSubscription
);

// -----------------------------------------------------------------------------
// 3. Platform Administration Billing & History
// -----------------------------------------------------------------------------
// Platform Owner: List all businesses with live days remaining sorted by soonest expiry
router.get(
  '/',
  authenticateToken,
  requirePlatformOwner,
  subscriptionController.listBusinessesBilling
);

// Platform Owner or Business Owner: Get specific business subscription
router.get(
  '/:businessId',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  enforceBusinessScope,
  subscriptionController.getBusinessSubscription
);

// Platform Owner or Business Owner: Get payment history ledger
router.get(
  '/:businessId/history',
  authenticateToken,
  authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]),
  enforceBusinessScope,
  subscriptionController.getBusinessHistory
);

// Platform Owner: Renew business subscription & record manual payment
router.post(
  '/:businessId/renew',
  authenticateToken,
  requirePlatformOwner,
  subscriptionController.renewSubscription
);

// Platform Owner: Cancel business subscription
router.post(
  '/:businessId/cancel',
  authenticateToken,
  requirePlatformOwner,
  subscriptionController.cancelSubscription
);

export default router;
