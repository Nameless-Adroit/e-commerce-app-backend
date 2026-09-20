/**
 * Core Authentication Service
 * Implements Phone Number + PIN for Store Staff/Admins, Super Admin credential exception,
 * session management, dual-token issuance, and brute-force mitigation.
 */
import bcrypt from 'bcryptjs';
import { query } from '../config/database.config.js';
import { ROLES, BUSINESS_STATUS } from '../config/constants.js';
import { normalizePhoneNumber, isValidPhoneNumber } from '../utils/phone.util.js';
import { hashPin, verifyPin, isValidPin } from '../utils/pin.util.js';
import { issueAccessToken } from '../utils/token.util.js';
import { createSession, rotateSessionToken, revokeSession, revokeAllUserSessions } from './session.service.js';
import { checkBruteForceLockout, handleFailedLoginAttempt, handleSuccessfulLogin } from './security.service.js';
import { recordAuditEvent } from './audit.service.js';

/**
 * Maps system user roles to client dashboard redirection targets
 */
export function getRoleDashboardRedirect(role) {
  switch (role) {
    case ROLES.SUPER_ADMIN:
      return '/super-admin';
    case ROLES.ADMIN:
      return '/admin';
    case ROLES.SELLER:
      return '/seller';
    default:
      return '/';
  }
}

/**
 * Authenticates user credentials and establishes an authenticated device session.
 * 
 * Supports:
 *  1. Normal Users (Admin, Seller): Phone Number + PIN
 *  2. Super Admin: Username/Email + Password
 *  3. Backward-compatible bridge for legacy users transitioning to PIN
 */
export async function authenticateUser({
  phoneNumber,
  pin,
  identifier,
  username,
  email,
  password,
  deviceName,
  deviceId,
  ipAddress,
  userAgent
}) {
  // 1. Resolve unified login credentials from single login form
  const rawId = (phoneNumber || identifier || username || email || '').trim();
  const rawSecret = (pin || password || '').trim();

  if (!rawId || !rawSecret) {
    const err = new Error('Please provide your login credentials (phone number or username, and PIN or password).');
    err.statusCode = 400;
    throw err;
  }

  const normalizedPhone = normalizePhoneNumber(rawId);
  const isPhone = normalizedPhone && isValidPhoneNumber(normalizedPhone);
  const loginIdentifier = isPhone ? normalizedPhone : rawId;

  // 1. Enforce brute-force lockout check
  await checkBruteForceLockout(loginIdentifier, ipAddress);

  // 2. Query user by phone_number, username, or email
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
     WHERE (u.phone_number = ? OR u.username = ? OR u.email = ?) LIMIT 1`,
    [normalizedPhone || rawId, rawId, rawId]
  );

  if (!users || users.length === 0) {
    await handleFailedLoginAttempt({ identifier: loginIdentifier, ipAddress, userAgent });
    const err = new Error('Invalid credentials. Please verify your phone number/username and secret.');
    err.statusCode = 401;
    throw err;
  }

  const user = users[0];

  // 3. Verify credentials against either PIN hash or password hash
  let isMatch = false;

  if (user.pin_hash && isValidPin(rawSecret)) {
    isMatch = await verifyPin(rawSecret, user.pin_hash);
  }

  if (!isMatch && user.password_hash) {
    isMatch = await bcrypt.compare(rawSecret, user.password_hash);
  }

  if (!isMatch) {
    await handleFailedLoginAttempt({ identifier: loginIdentifier, ipAddress, userAgent });
    const err = new Error('Invalid credentials. Please verify your phone number/username and PIN/password.');
    err.statusCode = 401;
    throw err;
  }

  // 3. Status checks
  if (!user.is_active) {
    const err = new Error('This user account has been deactivated. Please contact your manager.');
    err.statusCode = 403;
    throw err;
  }

  if (user.role !== ROLES.SUPER_ADMIN && user.business_status === BUSINESS_STATUS.SUSPENDED) {
    const err = new Error('Your business account has been suspended. Please contact platform support.');
    err.statusCode = 403;
    throw err;
  }

  // 4. Successful login: reset failed counters & record event
  await handleSuccessfulLogin({
    userId: user.id,
    identifier: loginIdentifier,
    ipAddress,
    userAgent
  });

  // 5. Establish authenticated session
  const session = await createSession({
    userId: user.id,
    deviceName,
    deviceId,
    ipAddress,
    userAgent
  });

  // 6. Issue 15-minute Access Token
  const accessToken = issueAccessToken({
    userId: user.id,
    role: user.role,
    businessId: user.business_id,
    shopId: user.shop_id,
    sessionId: session.sessionId
  });

  // 7. Determine effective display currencies
  const currencyCode = user.business_currency || user.shop_currency || 'TZS';
  const currencySymbol = user.business_currency_symbol || user.shop_currency_symbol || 'TSh';
  const currencyName = user.business_currency_name || user.shop_currency_name || 'Tanzanian Shilling';

  return {
    accessToken,
    refreshToken: session.rawRefreshToken,
    refreshTokenExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    redirect_url: getRoleDashboardRedirect(user.role),
    user: {
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
      temporary_password: Boolean(user.temporary_password),
      requires_pin_setup: !user.pin_hash && user.role !== ROLES.SUPER_ADMIN
    }
  };
}

/**
 * Rotates a refresh token and issues a fresh 15-minute access token.
 */
export async function refreshAccessToken({ rawRefreshToken, ipAddress, userAgent }) {
  const { session, newRawRefreshToken, expiresAt } = await rotateSessionToken({
    rawRefreshToken,
    ipAddress,
    userAgent
  });

  const accessToken = issueAccessToken({
    userId: session.userId,
    role: session.role,
    businessId: session.businessId,
    shopId: session.shopId,
    sessionId: session.id
  });

  return {
    accessToken,
    newRawRefreshToken,
    expiresAt,
    sessionId: session.id
  };
}

/**
 * Logout current authenticated session
 */
export async function logoutUser({ sessionId, userId }) {
  if (sessionId) {
    await revokeSession(sessionId, 'user_logout');
  }
}

/**
 * Logout all active sessions for current user
 */
export async function logoutAllSessions({ userId }) {
  if (userId) {
    await revokeAllUserSessions(userId, 'logout_all');
  }
}

/**
 * Registers a new user with role hierarchy enforcement and phone/PIN support.
 */
export async function registerUser({ currentUser, userData }) {
  const { username, email, phone_number, password, pin, role, business_id, shop_id, full_name, profile_image } = userData;

  if (!username || !email || !role || !full_name) {
    const err = new Error('Username, email, role, and full_name are required.');
    err.statusCode = 400;
    throw err;
  }

  // Validate Phone Number
  let normalizedPhone = null;
  if (phone_number) {
    normalizedPhone = normalizePhoneNumber(phone_number);
    if (!normalizedPhone || !isValidPhoneNumber(normalizedPhone)) {
      const err = new Error('Invalid phone number format.');
      err.statusCode = 400;
      throw err;
    }
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
      assignedShopId = null;
      isTempPassword = true;
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
  } else {
    const err = new Error('Forbidden: Unauthorized to create users.');
    err.statusCode = 403;
    throw err;
  }

  // Check unique collisions
  const existing = await query(
    'SELECT id FROM users WHERE username = ? OR email = ? OR (phone_number IS NOT NULL AND phone_number = ?) LIMIT 1',
    [username.trim(), email.trim(), normalizedPhone || '']
  );

  if (existing && existing.length > 0) {
    const err = new Error('Username, email, or phone number already exists in system.');
    err.statusCode = 409;
    throw err;
  }

  // Generate hashes
  const initialPassword = password || 'TempPass123!';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(initialPassword, salt);

  let pinHash = null;
  if (pin && isValidPin(pin)) {
    pinHash = await hashPin(pin);
  } else if (role !== ROLES.SUPER_ADMIN) {
    // Default PIN for new staff is '1234'
    pinHash = await hashPin('1234');
  }

  const result = await query(
    `INSERT INTO users 
      (username, email, phone_number, password_hash, pin_hash, profile_image, temporary_password, role, business_id, shop_id, full_name, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [
      username.trim(),
      email.trim(),
      normalizedPhone,
      passwordHash,
      pinHash,
      profile_image || null,
      isTempPassword ? 1 : 0,
      role,
      assignedBusinessId,
      assignedShopId,
      full_name.trim()
    ]
  );

  await recordAuditEvent({
    userId: currentUser.id,
    action: 'USER_CREATED',
    targetResource: 'users',
    targetId: result.insertId,
    shopId: assignedShopId,
    businessId: assignedBusinessId,
    changes: {
      username: username.trim(),
      email: email.trim(),
      phone_number: normalizedPhone,
      role,
      full_name: full_name.trim()
    }
  });

  return {
    id: result.insertId,
    username: username.trim(),
    email: email.trim(),
    phone_number: normalizedPhone,
    profile_image: profile_image || null,
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
  refreshAccessToken,
  logoutUser,
  logoutAllSessions,
  registerUser
};
