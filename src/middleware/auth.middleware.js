import { query } from '../config/database.config.js';
import { ROLES, BUSINESS_STATUS } from '../config/constants.js';
import { verifyAccessToken } from '../utils/token.util.js';
import { recordSecurityEvent } from '../services/security.service.js';

/**
 * Middleware: Verifies 15-minute Access Token, checks session revocation, and attaches user to request
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.split(' ')[1] 
    : null;

  // Fallback to query parameter (e.g. for direct PDF/labels downloads)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    recordSecurityEvent({
      eventType: 'AUTH_TOKEN_MISSING',
      ipAddress: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null,
      details: { path: req.originalUrl, method: req.method }
    }).catch(() => {});

    return res.status(401).json({
      success: false,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required. Please sign in to continue.'
    });
  }

  try {
    const decoded = verifyAccessToken(token);

    // If token includes session_id, verify session has not been revoked
    if (decoded.session_id) {
      const sessions = await query(
        'SELECT is_revoked FROM sessions WHERE id = ? LIMIT 1',
        [decoded.session_id]
      );
      if (sessions.length > 0 && sessions[0].is_revoked) {
        recordSecurityEvent({
          eventType: 'SESSION_REVOKED_ACCESS',
          userId: decoded.id,
          ipAddress: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null,
          userAgent: req.headers['user-agent'] || null,
          details: { sessionId: decoded.session_id, path: req.originalUrl }
        }).catch(() => {});

        return res.status(401).json({
          success: false,
          code: 'SESSION_EXPIRED',
          message: 'Your session has expired. Please sign in again.'
        });
      }
    }

    // Fetch latest user status, business info, and subscription state from DB
    const users = await query(
      `SELECT u.id, u.username, u.email, u.phone_number, u.profile_image, u.role, 
              u.business_id, u.shop_id, u.full_name, u.is_active, u.temporary_pin,
              b.name as business_name, b.currency_code as business_currency, b.currency_symbol as business_currency_symbol, 
              b.currency_name as business_currency_name, b.status as business_status,
              b.subscription_status, b.subscription_end_date
       FROM users u 
       LEFT JOIN businesses b ON u.business_id = b.id
       WHERE u.id = ? LIMIT 1`,
      [decoded.id]
    );

    if (!users || users.length === 0 || !users[0].is_active) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Account is invalid or deactivated.'
      });
    }

    const user = users[0];

    // Lazy subscription expiration enforcement without cron
    if (user.role !== ROLES.SUPER_ADMIN && user.business_id) {
      const isPending = ['payment_pending', 'payment_received', 'pending_review', 'draft'].includes(user.subscription_status);
      if (isPending) {
        return res.status(403).json({
          success: false,
          code: 'REGISTRATION_PENDING_APPROVAL',
          message: 'Your business registration is pending review or manual payment confirmation. Please contact the Technical Team.'
        });
      }

      if (user.subscription_status === 'declined') {
        return res.status(403).json({
          success: false,
          code: 'REGISTRATION_DECLINED',
          message: 'Your business registration was declined. Please contact the Technical Team.'
        });
      }

      const now = new Date();
      const isExpired = user.subscription_status === 'expired' || 
                        (user.subscription_end_date && new Date(user.subscription_end_date).getTime() < now.getTime());

      if (isExpired) {
        // Automatically persist expired state in DB on lazy evaluation
        if (user.subscription_status !== 'expired' || user.business_status !== BUSINESS_STATUS.SUSPENDED) {
          await query(
            "UPDATE businesses SET subscription_status = 'expired', status = 'suspended' WHERE id = ?",
            [user.business_id]
          );
        }

        // Allow reading own subscription info, profile, or logging out when expired
        const isAllowedWhenExpired = 
          req.originalUrl?.includes('/subscriptions/my') || 
          req.originalUrl?.includes('/auth/logout') ||
          req.originalUrl?.includes('/auth/profile');

        if (!isAllowedWhenExpired) {
          return res.status(403).json({
            success: false,
            code: 'SUBSCRIPTION_EXPIRED',
            message: 'Your business subscription has expired. Please contact the Technical Team to renew your service.'
          });
        }
      }

      if (user.business_status === BUSINESS_STATUS.SUSPENDED || user.subscription_status === 'cancelled') {
        return res.status(403).json({
          success: false,
          code: 'BUSINESS_SUSPENDED',
          message: 'Your business account has been suspended or cancelled. Please contact platform support.'
        });
      }
    }

    user.session_id = decoded.session_id || null;
    req.user = user;
    next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    recordSecurityEvent({
      eventType: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      ipAddress: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null,
      details: { errorName: err.name, errorMessage: err.message, path: req.originalUrl }
    }).catch(() => {});

    return res.status(401).json({
      success: false,
      code: isExpired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
      message: 'Your session has expired. Please sign in to continue.'
    });
  }
}

/**
 * Middleware: Strict Platform Owner (Super Admin) Access Guard
 */
export function requirePlatformOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    return res.status(403).json({
      success: false,
      code: 'PLATFORM_OWNER_REQUIRED',
      message: 'Forbidden: This resource is restricted to the Platform Owner / Technical Team.'
    });
  }
  next();
}

/**
 * Middleware: Mobile User Guard (Business Owners & Sellers only)
 * Explicitly prevents Super Admin token misuse on mobile client endpoints
 */
export function requireMobileUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (req.user.role === ROLES.SUPER_ADMIN) {
    return res.status(403).json({
      success: false,
      code: 'PLATFORM_OWNER_WEB_ONLY',
      message: 'Platform Owner administration is available exclusively via the Web Gateway.'
    });
  }
  next();
}

/**
 * Middleware: Strict Role-Based Access Control (RBAC)
 * @param {Array<string>|string} allowedRoles
 */
export function authorize(allowedRoles = []) {
  const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. User authentication required.'
      });
    }

    if (!rolesArray.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role '${req.user.role}' lacks permission to access this resource. Required roles: ${rolesArray.join(', ')}`
      });
    }

    next();
  };
}

/**
 * Middleware: Enforces multi-tenant business boundary isolation
 * - Super Admin can access all or target any business
 * - Admin and Seller are strictly locked to their business_id
 */
export function enforceBusinessScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  if (req.user.role === ROLES.SUPER_ADMIN) {
    req.targetBusinessId = req.params.businessId || req.params.id || req.query.business_id || req.body.business_id || null;
    return next();
  }

  if (!req.user.business_id) {
    return res.status(403).json({
      success: false,
      message: 'User is not assigned to any business entity.'
    });
  }

  // Cross-tenant protection: verify any requested businessId matches user's owned business
  const requestedBusinessId = req.params.businessId || req.params.id || req.query.business_id || req.body.business_id;
  if (requestedBusinessId && parseInt(requestedBusinessId, 10) !== parseInt(req.user.business_id, 10)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Unauthorized attempt to access another business entity.'
    });
  }

  req.targetBusinessId = req.user.business_id;
  next();
}

/**
 * Middleware: Enforces multi-tenant shop isolation
 * - Super Admins can target any shop or view system-wide
 * - Admins can target any shop belonging to their business (via X-Shop-Id header, query, or body)
 * - Sellers are strictly locked to their single assigned shop_id
 */
export async function enforceShopScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const requestedShopId = req.headers['x-shop-id'] || req.query.shop_id || req.body.shop_id || null;

  if (req.user.role === ROLES.SUPER_ADMIN) {
    req.targetShopId = requestedShopId ? parseInt(requestedShopId, 10) : null;
    return next();
  }

  if (req.user.role === ROLES.ADMIN) {
    if (!req.user.business_id) {
      return res.status(403).json({
        success: false,
        message: 'Admin is not associated with a business.'
      });
    }

    if (requestedShopId) {
      const parsedShopId = parseInt(requestedShopId, 10);
      // Verify shop belongs to Admin's business
      const shops = await query(
        'SELECT id, business_id FROM shops WHERE id = ? AND business_id = ? LIMIT 1',
        [parsedShopId, req.user.business_id]
      );

      if (!shops || shops.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: The requested shop does not belong to your business.'
        });
      }

      req.targetShopId = parsedShopId;
    } else {
      req.targetShopId = null;
    }

    return next();
  }

  // Seller Role: Strictly locked to assigned shop
  if (!req.user.shop_id) {
    return res.status(403).json({
      success: false,
      message: 'Seller is not assigned to any shop branch.'
    });
  }

  // Reject malicious attempts by Seller to access other shops
  if (requestedShopId && parseInt(requestedShopId, 10) !== parseInt(req.user.shop_id, 10)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Sellers are restricted to their assigned shop.'
    });
  }

  req.targetShopId = parseInt(req.user.shop_id, 10);
  next();
}

export default {
  authenticateToken,
  authorize,
  requirePlatformOwner,
  requireMobileUser,
  enforceBusinessScope,
  enforceShopScope
};
