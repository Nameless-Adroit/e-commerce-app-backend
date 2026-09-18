import jwt from 'jsonwebtoken';
import { query } from '../config/database.config.js';
import { ROLES, BUSINESS_STATUS } from '../config/constants.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_pos_ecommerce_2026';

/**
 * Middleware: Verifies JWT token and attaches user to request
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.split(' ')[1] 
    : null;

  // Fallback to query parameter (e.g. for direct PDF/labels downloads or browser window.open)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authorization token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch latest user status and business info from DB
    const users = await query(
      `SELECT u.id, u.username, u.email, u.role, u.business_id, u.shop_id, u.full_name, u.is_active, u.temporary_password,
              b.name as business_name, b.currency_code as business_currency, b.currency_symbol as business_currency_symbol, 
              b.currency_name as business_currency_name, b.status as business_status
       FROM users u 
       LEFT JOIN businesses b ON u.business_id = b.id
       WHERE u.id = ? LIMIT 1`,
      [decoded.id]
    );

    if (!users || users.length === 0 || !users[0].is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is invalid or deactivated.'
      });
    }

    const user = users[0];

    // If business is suspended, block access unless Super Admin
    if (user.role !== ROLES.SUPER_ADMIN && user.business_status === BUSINESS_STATUS.SUSPENDED) {
      return res.status(403).json({
        success: false,
        message: 'Your business account has been suspended. Please contact platform support.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.'
    });
  }
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
  enforceBusinessScope,
  enforceShopScope
};
