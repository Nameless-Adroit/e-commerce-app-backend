/**
 * Platform Administration Routes (Platform Owner / Technical Team Web Gateway)
 */
import express from 'express';
import * as platformController from '../controllers/platform.controller.js';
import { authenticateToken, requirePlatformOwner } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rate-limit.middleware.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// 1. Public Configuration Endpoint
// -----------------------------------------------------------------------------
// Safe for unauthenticated clients: returns platform contact info, manual payment instructions, and terms
router.get('/config', platformController.getPublicConfig);

// -----------------------------------------------------------------------------
// 2. Dedicated Platform Owner Login & Token Refresh
// -----------------------------------------------------------------------------
// Enforces rate limiting and strictly verifies Super Admin role
router.post('/auth/login', authRateLimiter, platformController.platformLogin);
router.post('/auth/refresh', authRateLimiter, platformController.platformRefresh);

// Payment Methods: Active methods readable by authenticated clients / mobile app
router.get('/payment-methods', platformController.listPaymentMethods);

// -----------------------------------------------------------------------------
// 3. Protected Platform Owner Operations (All require token & Platform Owner role)
// -----------------------------------------------------------------------------
router.use(authenticateToken);
router.use(requirePlatformOwner);

// Dashboard summary metrics
router.get('/dashboard', platformController.getDashboard);

// Registration requests review & approval
router.get('/registrations', platformController.listRegistrations);
router.post('/registrations/:id/approve', platformController.approveRegistration);
router.post('/registrations/:id/decline', platformController.declineRegistration);

// Platform Settings
router.get('/settings', platformController.getSettings);
router.put('/settings', platformController.updateSettings);

// Manual Payment Methods - Management (Create / Update restricted to Platform Owner)
router.post('/payment-methods', platformController.createPaymentMethod);
router.put('/payment-methods/:id', platformController.updatePaymentMethod);

// Platform Audit Logs
router.get('/audit-logs', platformController.getAuditLogs);

export default router;
