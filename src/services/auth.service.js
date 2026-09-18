import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.config.js';
import { ROLES, BUSINESS_STATUS } from '../config/constants.js';

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

  // Lookup user with business and shop associations
  const users = await query(
    `SELECT u.*, 
            b.name as business_name, b.business_code, b.currency_code as business_currency, 
            b.currency_symbol as business_currency_symbol, b.currency_name as business_currency_name,
            b.status as business_status,
            s.name as shop_name, s.shop_code, s.currency_code as shop_currency, 
            s.currency_symbol as shop_currency_symbol, s.currency_name as shop_currency_name
     FROM users u 
     LEFT JOIN businesses b ON u.business_id = b.id
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

  if (user.role !== ROLES.SUPER_ADMIN && user.business_status === BUSINESS_STATUS.SUSPENDED) {
    const err = new Error('Your business account has been suspended. Please contact platform support.');
    err.statusCode = 403;
    throw err;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const err = new Error('Invalid credentials. Password incorrect.');
    err.statusCode = 401;
    throw err;
  }

  // Determine effective currency (business currency takes precedence, fallback to shop currency or TZS)
  const currencyCode = user.business_currency || user.shop_currency || 'TZS';
  const currencySymbol = user.business_currency_symbol || user.shop_currency_symbol || 'TSh';
  const currencyName = user.business_currency_name || user.shop_currency_name || 'Tanzanian Shilling';

  // Generate JWT payload
  const tokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    business_id: user.business_id,
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
      business_id: user.business_id,
      business_name: user.business_name || null,
      business_code: user.business_code || null,
      shop_id: user.shop_id,
      shop_name: user.shop_name || null,
      shop_code: user.shop_code || null,
      shop_currency: currencyCode,
      shop_currency_symbol: currencySymbol,
      shop_currency_name: currencyName,
      temporary_password: Boolean(user.temporary_password)
    }
  };
}

/**
 * Get profile data for a specific user ID
 */
export async function getUserProfile(userId) {
  const users = await query(
    `SELECT u.id, u.username, u.email, u.role, u.full_name, u.business_id, u.shop_id, u.is_active, 
            u.temporary_password, u.created_at,
            b.name as business_name, b.business_code, b.currency_code as business_currency, 
            b.currency_symbol as business_currency_symbol, b.currency_name as business_currency_name,
            s.name as shop_name, s.shop_code, s.address as shop_address,
            s.currency_code as shop_currency, s.currency_symbol as shop_currency_symbol, s.currency_name as shop_currency_name
     FROM users u
     LEFT JOIN businesses b ON u.business_id = b.id
     LEFT JOIN shops s ON u.shop_id = s.id
     WHERE u.id = ? LIMIT 1`,
    [userId]
  );

  if (!users || users.length === 0) {
    const err = new Error('User not found.');
    err.statusCode = 404;
    throw err;
  }

  const user = users[0];
  const currencyCode = user.business_currency || user.shop_currency || 'TZS';
  const currencySymbol = user.business_currency_symbol || user.shop_currency_symbol || 'TSh';
  const currencyName = user.business_currency_name || user.shop_currency_name || 'Tanzanian Shilling';

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    business_id: user.business_id,
    business_name: user.business_name || null,
    business_code: user.business_code || null,
    shop_id: user.shop_id,
    shop_name: user.shop_name || null,
    shop_code: user.shop_code || null,
    shop_currency: currencyCode,
    shop_currency_symbol: currencySymbol,
    shop_currency_name: currencyName,
    temporary_password: Boolean(user.temporary_password),
    is_active: Boolean(user.is_active),
    created_at: user.created_at
  };
}

/**
 * Change password for authenticated user (clears temporary_password)
 */
export async function changePassword({ userId, oldPassword, newPassword }) {
  if (!oldPassword || !newPassword) {
    const err = new Error('Both current password and new password are required.');
    err.statusCode = 400;
    throw err;
  }

  if (newPassword.length < 6) {
    const err = new Error('New password must be at least 6 characters long.');
    err.statusCode = 400;
    throw err;
  }

  const users = await query('SELECT id, password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!users || users.length === 0) {
    const err = new Error('User not found.');
    err.statusCode = 404;
    throw err;
  }

  const user = users[0];
  const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
  if (!isMatch) {
    const err = new Error('Current password is incorrect.');
    err.statusCode = 400;
    throw err;
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);

  await query(
    'UPDATE users SET password_hash = ?, temporary_password = FALSE WHERE id = ?',
    [newHash, userId]
  );

  return { success: true, message: 'Password changed successfully.' };
}

/**
 * Super Admin resets Admin / User password and flags as temporary password
 */
export async function resetPassword({ targetUserId, newPassword, currentUser }) {
  if (currentUser.role !== ROLES.SUPER_ADMIN && currentUser.role !== ROLES.ADMIN) {
    const err = new Error('Forbidden: Unauthorized to reset user passwords.');
    err.statusCode = 403;
    throw err;
  }

  if (!newPassword || newPassword.length < 6) {
    const err = new Error('Temporary password must be at least 6 characters.');
    err.statusCode = 400;
    throw err;
  }

  const users = await query('SELECT id, role, business_id FROM users WHERE id = ? LIMIT 1', [targetUserId]);
  if (!users || users.length === 0) {
    const err = new Error('Target user not found.');
    err.statusCode = 404;
    throw err;
  }

  const targetUser = users[0];

  // Admin can only reset password of sellers in own business
  if (currentUser.role === ROLES.ADMIN) {
    if (targetUser.role !== ROLES.SELLER || targetUser.business_id !== currentUser.business_id) {
      const err = new Error('Forbidden: You can only reset passwords for sellers in your business.');
      err.statusCode = 403;
      throw err;
    }
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);

  await query(
    'UPDATE users SET password_hash = ?, temporary_password = TRUE WHERE id = ?',
    [newHash, targetUserId]
  );

  return {
    success: true,
    message: 'User credentials reset successfully with temporary password.'
  };
}

/**
 * Toggle user active / suspended status
 */
export async function setUserActiveStatus({ targetUserId, isActive, currentUser }) {
  const users = await query('SELECT id, role, business_id FROM users WHERE id = ? LIMIT 1', [targetUserId]);
  if (!users || users.length === 0) {
    const err = new Error('User not found.');
    err.statusCode = 404;
    throw err;
  }

  const targetUser = users[0];

  if (currentUser.role === ROLES.ADMIN) {
    if (targetUser.role !== ROLES.SELLER || targetUser.business_id !== currentUser.business_id) {
      const err = new Error('Forbidden: Admins can only manage status of sellers in their business.');
      err.statusCode = 403;
      throw err;
    }
  } else if (currentUser.role !== ROLES.SUPER_ADMIN) {
    const err = new Error('Forbidden: Unauthorized.');
    err.statusCode = 403;
    throw err;
  }

  await query('UPDATE users SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, targetUserId]);

  return {
    success: true,
    user_id: targetUserId,
    is_active: Boolean(isActive)
  };
}

/**
 * List users with role / business filters
 */
export async function listUsers({ currentUser, role, businessId, shopId }) {
  let whereClauses = [];
  let params = [];

  if (currentUser.role === ROLES.ADMIN) {
    whereClauses.push('u.business_id = ?');
    params.push(currentUser.business_id);
  } else if (currentUser.role === ROLES.SUPER_ADMIN) {
    if (businessId) {
      whereClauses.push('u.business_id = ?');
      params.push(parseInt(businessId, 10));
    }
  } else {
    // Seller only sees self
    whereClauses.push('u.id = ?');
    params.push(currentUser.id);
  }

  if (role) {
    whereClauses.push('u.role = ?');
    params.push(role);
  }

  if (shopId) {
    whereClauses.push('u.shop_id = ?');
    params.push(parseInt(shopId, 10));
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT u.id, u.username, u.email, u.full_name, u.role, u.business_id, u.shop_id, 
           u.is_active, u.temporary_password, u.created_at,
           b.name as business_name, b.business_code,
           s.name as shop_name, s.shop_code
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    LEFT JOIN shops s ON u.shop_id = s.id
    ${whereStr}
    ORDER BY u.role ASC, u.id ASC
  `;

  const users = await query(sql, params);
  return users.map(u => ({
    ...u,
    is_active: Boolean(u.is_active),
    temporary_password: Boolean(u.temporary_password)
  }));
}

/**
 * Register a new user with strict multi-tier hierarchy validation
 */
export async function registerUser({ currentUser, userData }) {
  const { username, email, password, role, business_id, shop_id, full_name } = userData;

  if (!username || !email || !password || !role || !full_name) {
    const err = new Error('Username, email, password, role, and full_name are required.');
    err.statusCode = 400;
    throw err;
  }

  let assignedBusinessId = null;
  let assignedShopId = null;
  let isTempPassword = false;

  // Role hierarchy permission checks
  if (currentUser.role === ROLES.ADMIN) {
    if (role !== ROLES.SELLER) {
      const err = new Error('Admins are only permitted to register Sellers for their business.');
      err.statusCode = 403;
      throw err;
    }

    assignedBusinessId = currentUser.business_id;

    if (!shop_id) {
      const err = new Error('A shop_id is required when registering a Seller.');
      err.statusCode = 400;
      throw err;
    }

    // Verify shop belongs to Admin's business
    const shops = await query('SELECT id FROM shops WHERE id = ? AND business_id = ? LIMIT 1', [shop_id, assignedBusinessId]);
    if (!shops || shops.length === 0) {
      const err = new Error('The specified shop does not belong to your business.');
      err.statusCode = 403;
      throw err;
    }
    assignedShopId = parseInt(shop_id, 10);
  } else if (currentUser.role === ROLES.SUPER_ADMIN) {
    if (role === ROLES.ADMIN) {
      if (!business_id) {
        const err = new Error('A business_id must be specified when creating an Admin account.');
        err.statusCode = 400;
        throw err;
      }
      assignedBusinessId = parseInt(business_id, 10);
      assignedShopId = null; // Admin owns business, not single shop
      isTempPassword = true; // Admin receives temporary credentials
    } else if (role === ROLES.SELLER) {
      if (!shop_id) {
        const err = new Error('A shop_id must be provided when registering a Seller.');
        err.statusCode = 400;
        throw err;
      }
      const shops = await query('SELECT id, business_id FROM shops WHERE id = ? LIMIT 1', [shop_id]);
      if (!shops || shops.length === 0) {
        const err = new Error('Shop not found.');
        err.statusCode = 404;
        throw err;
      }
      assignedShopId = shops[0].id;
      assignedBusinessId = shops[0].business_id;
    }
  }

  // Check for collision
  const existing = await query(
    'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
    [username.trim(), email.trim()]
  );

  if (existing && existing.length > 0) {
    const err = new Error('Username or email already exists in system.');
    err.statusCode = 409;
    throw err;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const result = await query(
    `INSERT INTO users (username, email, password_hash, temporary_password, role, business_id, shop_id, full_name, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [username.trim(), email.trim(), passwordHash, isTempPassword ? 1 : 0, role, assignedBusinessId, assignedShopId, full_name.trim()]
  );

  return {
    id: result.insertId,
    username: username.trim(),
    email: email.trim(),
    role,
    business_id: assignedBusinessId,
    shop_id: assignedShopId,
    full_name: full_name.trim(),
    temporary_password: isTempPassword
  };
}

export default {
  getRoleDashboardRedirect,
  authenticateUser,
  getUserProfile,
  changePassword,
  resetPassword,
  setUserActiveStatus,
  listUsers,
  registerUser
};
