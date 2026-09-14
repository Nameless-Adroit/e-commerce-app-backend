import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.config.js';
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
 * Authenticates user credentials and generates JWT token
 */
export async function authenticateUser({ identifier, username, email, password }) {
  const loginId = identifier || username || email;

  if (!loginId || !password) {
    const err = new Error('Username/email and password are required.');
    err.statusCode = 400;
    throw err;
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
    const err = new Error('Invalid credentials. User not found.');
    err.statusCode = 401;
    throw err;
  }

  const user = users[0];

  if (!user.is_active) {
    const err = new Error('This user account has been deactivated.');
    err.statusCode = 403;
    throw err;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const err = new Error('Invalid credentials. Password incorrect.');
    err.statusCode = 401;
    throw err;
  }

  // Generate JWT payload
  const tokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    shop_id: user.shop_id
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return {
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
  };
}

/**
 * Get profile data for a specific user ID
 */
export async function getUserProfile(userId) {
  const users = await query(
    `SELECT u.id, u.username, u.email, u.role, u.full_name, u.shop_id, u.created_at,
            s.name as shop_name, s.shop_code, s.address as shop_address
     FROM users u
     LEFT JOIN shops s ON u.shop_id = s.id
     WHERE u.id = ? LIMIT 1`,
    [userId]
  );

  if (!users || users.length === 0) {
    const err = new Error('User not found.');
    err.statusCode = 404;
    throw err;
  }

  return users[0];
}

/**
 * Register a new user with role hierarchy validation
 */
export async function registerUser({ currentUser, userData }) {
  const { username, email, password, role, shop_id, full_name } = userData;

  if (!username || !email || !password || !role || !full_name) {
    const err = new Error('Username, email, password, role, and full_name are required.');
    err.statusCode = 400;
    throw err;
  }

  // Role hierarchy permission checks
  if (currentUser.role === ROLES.ADMIN) {
    if (role !== ROLES.SELLER) {
      const err = new Error('Admins are only permitted to register Sellers for their assigned shop.');
      err.statusCode = 403;
      throw err;
    }
  }

  // Determine target shop
  const assignedShopId = currentUser.role === ROLES.SUPER_ADMIN ? (shop_id || null) : currentUser.shop_id;

  if (role !== ROLES.SUPER_ADMIN && !assignedShopId) {
    const err = new Error('A shop_id must be provided for Admin or Seller roles.');
    err.statusCode = 400;
    throw err;
  }

  // Check for collision
  const existing = await query(
    'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
    [username, email]
  );

  if (existing && existing.length > 0) {
    const err = new Error('Username or email already exists in system.');
    err.statusCode = 409;
    throw err;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const result = await query(
    `INSERT INTO users (username, email, password_hash, role, shop_id, full_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, email, passwordHash, role, assignedShopId, full_name]
  );

  return {
    id: result.insertId,
    username,
    email,
    role,
    shop_id: assignedShopId,
    full_name
  };
}

export default {
  getRoleDashboardRedirect,
  authenticateUser,
  getUserProfile,
  registerUser
};
