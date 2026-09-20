/**
 * User Identity & Profile Management Service
 * Supports Super Admin user editing, self-service profile updates, and identity propagation.
 */
import { query } from '../config/database.config.js';
import { ROLES } from '../config/constants.js';
import { normalizePhoneNumber, isValidPhoneNumber } from '../utils/phone.util.js';
import { hashPin, isValidPin } from '../utils/pin.util.js';
import { recordAuditEvent } from './audit.service.js';

/**
 * Retrieves full user identity record by ID
 * 
 * @param {number} userId
 * @returns {Promise<object>}
 */
export async function getUserProfile(userId) {
  const users = await query(
    `SELECT u.id, u.username, u.email, u.phone_number, u.profile_image, u.role, u.full_name,
            u.business_id, u.shop_id, u.is_active, u.temporary_pin, u.created_at, u.updated_at,
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
    phone_number: user.phone_number,
    profile_image: user.profile_image,
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
    temporary_pin: Boolean(user.temporary_pin ?? user.temporary_password),
    temporary_password: Boolean(user.temporary_pin ?? user.temporary_password),
    is_active: Boolean(user.is_active),
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

/**
 * Self-service profile update for currently authenticated user
 * 
 * @param {number} userId
 * @param {object} updates
 * @returns {Promise<object>} Updated profile
 */
export async function updateUserProfile(userId, { full_name, phone_number, profile_image }) {
  const fields = [];
  const params = [];
  const auditDiff = {};

  if (full_name !== undefined) {
    fields.push('full_name = ?');
    params.push(full_name.trim());
    auditDiff.full_name = full_name.trim();
  }

  if (phone_number !== undefined) {
    const normalized = phone_number ? normalizePhoneNumber(phone_number) : null;
    if (normalized) {
      // Check collision
      const existing = await query('SELECT id FROM users WHERE phone_number = ? AND id != ? LIMIT 1', [normalized, userId]);
      if (existing.length > 0) {
        const err = new Error('This phone number is already registered to another account.');
        err.statusCode = 409;
        throw err;
      }
    }
    fields.push('phone_number = ?');
    params.push(normalized);
    auditDiff.phone_number = normalized;
  }

  if (profile_image !== undefined) {
    fields.push('profile_image = ?');
    params.push(profile_image || null);
    auditDiff.profile_image = profile_image || null;
  }

  if (fields.length === 0) {
    return getUserProfile(userId);
  }

  params.push(userId);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

  await recordAuditEvent({
    userId,
    action: 'USER_PROFILE_UPDATED',
    targetResource: 'users',
    targetId: userId,
    changes: auditDiff
  });

  return getUserProfile(userId);
}

/**
 * Super Admin or Admin updates a user's account details
 * 
 * @param {object} params
 * @param {number} params.targetUserId
 * @param {object} params.updateData
 * @param {object} params.currentUser
 * @returns {Promise<object>}
 */
export async function adminUpdateUser({ targetUserId, updateData, currentUser }) {
  const { full_name, phone_number, email, role, business_id, shop_id, profile_image, pin } = updateData;

  const users = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [targetUserId]);
  if (!users || users.length === 0) {
    const err = new Error('Target user not found.');
    err.statusCode = 404;
    throw err;
  }

  const targetUser = users[0];

  // RBAC permissions check
  if (currentUser.role === ROLES.ADMIN) {
    if (targetUser.role !== ROLES.SELLER || targetUser.business_id !== currentUser.business_id) {
      const err = new Error('Forbidden: Admins can only manage Sellers within their business.');
      err.statusCode = 403;
      throw err;
    }
    if (role && role !== ROLES.SELLER) {
      const err = new Error('Forbidden: Admins cannot change roles.');
      err.statusCode = 403;
      throw err;
    }
  } else if (currentUser.role !== ROLES.SUPER_ADMIN) {
    const err = new Error('Forbidden: Insufficient privileges to update user.');
    err.statusCode = 403;
    throw err;
  }

  const fields = [];
  const params = [];
  const auditDiff = {};

  if (full_name) {
    fields.push('full_name = ?');
    params.push(full_name.trim());
    auditDiff.full_name = full_name.trim();
  }

  if (email && email !== targetUser.email) {
    const existing = await query('SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1', [email.trim(), targetUserId]);
    if (existing.length > 0) {
      const err = new Error('Email is already registered.');
      err.statusCode = 409;
      throw err;
    }
    fields.push('email = ?');
    params.push(email.trim());
    auditDiff.email = email.trim();
  }

  if (phone_number !== undefined) {
    const normalized = phone_number ? normalizePhoneNumber(phone_number) : null;
    if (normalized) {
      const existing = await query('SELECT id FROM users WHERE phone_number = ? AND id != ? LIMIT 1', [normalized, targetUserId]);
      if (existing.length > 0) {
        const err = new Error('Phone number is already registered.');
        err.statusCode = 409;
        throw err;
      }
    }
    fields.push('phone_number = ?');
    params.push(normalized);
    auditDiff.phone_number = normalized;
  }

  if (profile_image !== undefined) {
    fields.push('profile_image = ?');
    params.push(profile_image || null);
    auditDiff.profile_image = profile_image || null;
  }

  if (role && currentUser.role === ROLES.SUPER_ADMIN) {
    fields.push('role = ?');
    params.push(role);
    auditDiff.role = role;
  }

  if (business_id !== undefined && currentUser.role === ROLES.SUPER_ADMIN) {
    fields.push('business_id = ?');
    params.push(business_id ? parseInt(business_id, 10) : null);
    auditDiff.business_id = business_id;
  }

  if (shop_id !== undefined) {
    fields.push('shop_id = ?');
    params.push(shop_id ? parseInt(shop_id, 10) : null);
    auditDiff.shop_id = shop_id;
  }

  if (pin && isValidPin(pin)) {
    const pinHash = await hashPin(pin);
    fields.push('pin_hash = ?');
    params.push(pinHash);
    auditDiff.pin = '[UPDATED]';
  }

  if (fields.length > 0) {
    params.push(targetUserId);
    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

    await recordAuditEvent({
      userId: currentUser.id,
      action: 'ADMIN_USER_UPDATED',
      targetResource: 'users',
      targetId: targetUserId,
      shopId: targetUser.shop_id,
      businessId: targetUser.business_id,
      changes: auditDiff
    });
  }

  return getUserProfile(targetUserId);
}

/**
 * Sets or changes a user's PIN
 * 
 * @param {number} userId
 * @param {string} newPin
 * @param {string|null} oldPin (optional verification for self-service)
 */
export async function setUserPin(userId, newPin, oldPin = null) {
  if (!isValidPin(newPin)) {
    const err = new Error('PIN must be exactly 6 numeric digits.');
    err.statusCode = 400;
    throw err;
  }

  if (oldPin) {
    const users = await query('SELECT pin_hash FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!users || users.length === 0) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }
    if (users[0].pin_hash) {
      const { verifyPin } = await import('../utils/pin.util.js');
      const isMatch = await verifyPin(oldPin, users[0].pin_hash);
      if (!isMatch) {
        const err = new Error('Current PIN is incorrect.');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const pinHash = await hashPin(newPin);
  await query('UPDATE users SET pin_hash = ?, temporary_pin = FALSE WHERE id = ?', [pinHash, userId]);

  await recordAuditEvent({
    userId,
    action: 'PIN_CHANGED',
    targetResource: 'users',
    targetId: userId,
    changes: { pin: '[CHANGED]' }
  });

  return { success: true, message: 'PIN updated successfully.' };
}

export default {
  getUserProfile,
  updateUserProfile,
  adminUpdateUser,
  setUserPin
};
