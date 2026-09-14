import jwt from 'jsonwebtoken';
import { query } from '../config/database.config.js';
import { ROLES } from '../config/constants.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_pos_ecommerce_2026';

/**
 * Middleware: Verifies JWT token and attaches user to request
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.split(' ')[1] 
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authorization token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch latest user status from DB to ensure account is active
    const users = await query(
      'SELECT id, username, email, role, shop_id, full_name, is_active FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (!users || users.length === 0 || !users[0].is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is invalid or deactivated.'
      });
    }

    req.user = users[0];
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
 * Middleware: Enforces multi-tenant shop isolation
 * - Super Admins can optionally target any shop via query/body or view all
 * - Admins and Sellers are strictly scoped to their assigned shop_id
 */
export function enforceShopScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  if (req.user.role === ROLES.SUPER_ADMIN) {
    // Super Admin can provide shop_id or omit to view system-wide
    req.targetShopId = req.query.shop_id || req.body.shop_id || null;
    return next();
  }

  // Admins & Sellers must have an assigned shop
  if (!req.user.shop_id) {
    return res.status(403).json({
      success: false,
      message: 'User is not assigned to any shop.'
    });
  }

  // Strictly enforce user's shop ID
  req.targetShopId = req.user.shop_id;
  next();
}

export default {
  authenticateToken,
  authorize,
  enforceShopScope
};
