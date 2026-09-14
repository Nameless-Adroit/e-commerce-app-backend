import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { ROLES } from '../config/constants.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_pos_ecommerce_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

/**
 * Maps system user roles to client dashboard redirection targets (SRS 3.1)
 */
export function getRoleDashboardRedirect(role) {
  switch (role) {
    case ROLES.SUPER_ADMIN:
      return '/dashboard/super-admin';
    case ROLES.ADMIN:
      return '/dashboard/admin';
    case ROLES.SELLER:
      return '/dashboard/seller';
    default:
      return '/dashboard';
  }
}

/**
 * Unified Login Portal (SRS 3.1)
 * Accepts username or email, authenticates password, and returns role-specific redirection info.
 */
export async function login(req, res, next) {
  try {
    const { identifier, username, email, password } = req.body;
    const loginId = identifier || username || email;

    if (!loginId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username/email and password are required.'
      });
    }

    // Lookup user by username or email
    const users = await query(
      `SELECT u.*, s.name as shop_name, s.shop_code 
       FROM users u 
       LEFT JOIN shops s ON u.shop_id = s.id 
       WHERE (u.username = ? OR u.email = ?) LIMIT 1`,
      [loginId, loginId]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. User not found.'
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'This user account has been deactivated.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Password incorrect.'
      });
    }

    // Generate JWT payload
    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      shop_id: user.shop_id
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      data: {
        token,
        redirect_url: getRoleDashboardRedirect(user.role),
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          shop_id: user.shop_id,
          shop_name: user.shop_name || null,
          shop_code: user.shop_code || null
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get current authenticated user profile
 */
export async function getProfile(req, res, next) {
  try {
    const users = await query(
      `SELECT u.id, u.username, u.email, u.role, u.full_name, u.shop_id, u.created_at,
              s.name as shop_name, s.shop_code, s.address as shop_address
       FROM users u
       LEFT JOIN shops s ON u.shop_id = s.id
       WHERE u.id = ? LIMIT 1`,
      [req.user.id]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.status(200).json({
      success: true,
      data: users[0]
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new user (Restricted to Super Admin or Shop Admin)
 * - Super Admin can create Super Admin, Admin, or Seller across any shop
 * - Admin can only create Sellers within their assigned shop
 */
export async function registerUser(req, res, next) {
  try {
    const { username, email, password, role, shop_id, full_name } = req.body;

    if (!username || !email || !password || !role || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, password, role, and full_name are required.'
      });
    }

    // Role hierarchy permission checks
    if (req.user.role === ROLES.ADMIN) {
      if (role !== ROLES.SELLER) {
        return res.status(403).json({
          success: false,
          message: 'Admins are only permitted to register Sellers for their assigned shop.'
        });
      }
    }

    // Determine target shop
    const assignedShopId = req.user.role === ROLES.SUPER_ADMIN ? (shop_id || null) : req.user.shop_id;

    if (role !== ROLES.SUPER_ADMIN && !assignedShopId) {
      return res.status(400).json({
        success: false,
        message: 'A shop_id must be provided for Admin or Seller roles.'
      });
    }

    // Check for collision
    const existing = await query(
      'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );

    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Username or email already exists in system.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await query(
      `INSERT INTO users (username, email, password_hash, role, shop_id, full_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, role, assignedShopId, full_name]
    );

    res.status(201).json({
      success: true,
      message: 'User successfully created.',
      data: {
        id: result.insertId,
        username,
        email,
        role,
        shop_id: assignedShopId,
        full_name
      }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  getRoleDashboardRedirect,
  login,
  getProfile,
  registerUser
};
