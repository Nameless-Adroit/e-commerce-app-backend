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
import { checkBruteForceLockout, handleFailedLoginAttempt, handleSuccessfulLogin, recordSecurityEvent } from './security.service.js';
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
 * Strict Single Authentication Scheme:
 *  - Identifier: Phone Number ONLY (+255XXXXXXXXX or 07XXXXXXXX)
 *  - Secret: 6-Digit Numeric PIN ONLY
 */
export async function authenticateUser({
  phoneNumber,
  pin,
  identifier,
  secret,
  deviceName,
  deviceId,
  ipAddress,
  userAgent
}) {
  const rawPhone = (phoneNumber || identifier || '').trim();
  const rawPin = (pin || secret || '').trim();

  if (!rawPhone || !rawPin) {
    const err = new Error('INVALID CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 400;
    throw err;
  }

  const normalizedPhone = normalizePhoneNumber(rawPhone);
  if (!normalizedPhone || !isValidPhoneNumber(normalizedPhone)) {
    const err = new Error('INVALID CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 400;
    throw err;
  }

  if (!isValidPin(rawPin)) {
    const err = new Error('INVALID CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 400;
    throw err;
  }

  // 1. Enforce brute-force lockout check on phone number & IP
  await checkBruteForceLockout(normalizedPhone, ipAddress);

  // 2. Query user strictly by phone_number (supports both normalized E.164 and local format)
  const users = await query(
    `SELECT u.*, 
            b.name as business_name, b.business_code, b.currency_code as business_currency, 
            b.currency_symbol as business_currency_symbol, b.currency_name as business_currency_name,
            b.status as business_status, b.subscription_status, b.subscription_end_date,
            s.name as shop_name, s.shop_code, s.currency_code as shop_currency, 
            s.currency_symbol as shop_currency_symbol, s.currency_name as shop_currency_name
     FROM users u 
     LEFT JOIN businesses b ON u.business_id = b.id
     LEFT JOIN shops s ON u.shop_id = s.id 
     WHERE (u.phone_number = ? OR u.phone_number = ?) LIMIT 1`,
    [normalizedPhone, rawPhone]
  );

  if (!users || users.length === 0) {
    await handleFailedLoginAttempt({ identifier: normalizedPhone, ipAddress, userAgent });
    const err = new Error('INVALID CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 401;
    throw err;
  }

  const user = users[0];

  // 3. Verify credentials strictly against 6-digit PIN hash
  if (!user.pin_hash) {
    await handleFailedLoginAttempt({ identifier: normalizedPhone, ipAddress, userAgent });
    const err = new Error('INVALID CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 401;
    throw err;
  }

  const isMatch = await verifyPin(rawPin, user.pin_hash);

  if (!isMatch) {
    await handleFailedLoginAttempt({ identifier: normalizedPhone, ipAddress, userAgent });
    const err = new Error('INVALID CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 401;
    throw err;
  }

  // 3. Status checks
  if (user.role !== ROLES.SUPER_ADMIN && user.business_id) {
    if (['payment_pending', 'payment_received', 'pending_review', 'draft'].includes(user.subscription_status)) {
      const err = new Error('Your business registration is pending review or manual payment confirmation. Please contact the Technical Team.');
      err.statusCode = 403;
      err.code = 'REGISTRATION_PENDING_APPROVAL';
      throw err;
    }
    if (user.subscription_status === 'declined') {
      const err = new Error('Your business registration was declined. Please contact the Technical Team for assistance.');
      err.statusCode = 403;
      err.code = 'REGISTRATION_DECLINED';
      throw err;
    }
    const isPastEnd = user.subscription_end_date && new Date(user.subscription_end_date).getTime() < Date.now();
    if (user.subscription_status === 'expired' || isPastEnd) {
      const err = new Error('Your business subscription has expired. Please contact the Technical Team to renew your service.');
      err.statusCode = 403;
      err.code = 'SUBSCRIPTION_EXPIRED';
      throw err;
    }
    if (user.business_status === BUSINESS_STATUS.SUSPENDED) {
      await recordSecurityEvent({
        eventType: 'LOGIN_BLOCKED_BUSINESS_SUSPENDED',
        userId: user.id,
        identifier: normalizedPhone,
        ipAddress,
        userAgent,
        details: { businessId: user.business_id, businessName: user.business_name }
      }).catch(() => {});
      const err = new Error('INVALID CREDENTIALS');
      err.statusCode = 401;
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }
  }

  if (!user.is_active) {
    await recordSecurityEvent({
      eventType: 'LOGIN_BLOCKED_USER_DEACTIVATED',
      userId: user.id,
      identifier: normalizedPhone,
      ipAddress,
      userAgent,
      details: { role: user.role, businessId: user.business_id, shopId: user.shop_id }
    }).catch(() => {});
    const err = new Error('INVALID CREDENTIALS');
    err.statusCode = 401;
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }

  // 4. Successful login: reset failed counters & record event
  await handleSuccessfulLogin({
    userId: user.id,
    identifier: normalizedPhone,
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
    rawRefreshToken: session.rawRefreshToken,
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
      temporary_pin: Boolean(user.temporary_pin ?? user.temporary_password),
      temporary_password: Boolean(user.temporary_pin ?? user.temporary_password),
      requires_pin_setup: !user.pin_hash
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

  if (!role || !full_name) {
    const err = new Error('Role and full_name are required.');
    err.statusCode = 400;
    throw err;
  }

  // Validate Phone Number
  let normalizedPhone = null;
  if (phone_number) {
    normalizedPhone = normalizePhoneNumber(phone_number);
    if (!normalizedPhone || !isValidPhoneNumber(normalizedPhone)) {
      const err = new Error('Invalid phone number format (e.g. 0712 100 001 or +255712100001).');
      err.statusCode = 400;
      throw err;
    }
  }

  // Cashiers/Sellers require a phone number for POS counter login
  if (role === ROLES.SELLER && !normalizedPhone) {
    const err = new Error('A valid phone number is required for cashier sign in.');
    err.statusCode = 400;
    throw err;
  }

  // Auto-generate username and email for cashiers/sellers if not provided, or ensure presence for other roles
  let finalUsername = username ? String(username).trim() : null;
  let finalEmail = email ? String(email).trim() : null;

  if (role === ROLES.SELLER) {
    const phoneDigits = normalizedPhone ? normalizedPhone.replace(/\D/g, '') : Date.now();
    if (!finalUsername) {
      finalUsername = normalizedPhone || `seller_${phoneDigits}`;
    }
    if (!finalEmail) {
      finalEmail = `${phoneDigits}@cashier.local`;
    }
  } else {
    // For non-seller roles (admin, super_admin), username and email must be explicitly provided
    if (!finalUsername || !finalEmail) {
      const err = new Error('Username and email are required for administrative roles.');
      err.statusCode = 400;
      throw err;
    }
  }

  let assignedBusinessId = null;
  let assignedShopId = null;
  let isTempPin = false;

  // Role hierarchy permission checks
  if (currentUser.role === ROLES.ADMIN) {
    if (role !== ROLES.SELLER) {
      const err = new Error('Forbidden: Store Admins can only register Sellers.');
      err.statusCode = 403;
      throw err;
    }

    assignedBusinessId = currentUser.business_id;

    // Enforce subscription plan seller limit
    const { enforceSellerLimit } = await import('./subscription.service.js');
    await enforceSellerLimit(assignedBusinessId);

    if (!shop_id) {
      const err = new Error('A valid shop_id within your business must be specified.');
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
    isTempPin = true;
  } else if (currentUser.role === ROLES.SUPER_ADMIN) {
    if (role === ROLES.ADMIN) {
      if (!business_id) {
        const err = new Error('A business_id must be specified when creating an Admin account.');
        err.statusCode = 400;
        throw err;
      }
      assignedBusinessId = parseInt(business_id, 10);
      assignedShopId = null;
      isTempPin = true;
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
      isTempPin = true;

      // Enforce subscription plan seller limit
      const { enforceSellerLimit } = await import('./subscription.service.js');
      await enforceSellerLimit(assignedBusinessId);
    } else if (role === ROLES.SUPER_ADMIN) {
      // Super Admin provisioning another Super Admin
      isTempPin = true;
    }
  } else {
    const err = new Error('Forbidden: Unauthorized to create users.');
    err.statusCode = 403;
    throw err;
  }

  // Check unique collisions
  const existing = await query(
    'SELECT id, username, email, phone_number FROM users WHERE username = ? OR email = ? OR (phone_number IS NOT NULL AND phone_number = ?) LIMIT 1',
    [finalUsername, finalEmail, normalizedPhone || '']
  );

  if (existing && existing.length > 0) {
    const match = existing[0];
    if (normalizedPhone && match.phone_number === normalizedPhone) {
      const err = new Error('A user account with this phone number already exists.');
      err.statusCode = 409;
      throw err;
    }
    if (match.username === finalUsername) {
      const err = new Error('This username is already taken. Please choose another.');
      err.statusCode = 409;
      throw err;
    }
    const err = new Error('A user account with this email, username, or phone number already exists.');
    err.statusCode = 409;
    throw err;
  }

  let pinHash = null;
  if (pin && isValidPin(pin)) {
    pinHash = await hashPin(pin);
  } else {
    // Default 6-digit PIN for new user is '123456'
    pinHash = await hashPin('123456');
  }

  const result = await query(
    `INSERT INTO users 
      (username, email, phone_number, pin_hash, profile_image, temporary_pin, role, business_id, shop_id, full_name, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [
      finalUsername,
      finalEmail,
      normalizedPhone,
      pinHash,
      profile_image || null,
      isTempPin ? 1 : 0,
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
      username: finalUsername,
      email: finalEmail,
      phone_number: normalizedPhone,
      role,
      full_name: full_name.trim()
    }
  });

  return {
    id: result.insertId,
    username: finalUsername,
    email: finalEmail,
    phone_number: normalizedPhone,
    profile_image: profile_image || null,
    role,
    business_id: assignedBusinessId,
    shop_id: assignedShopId,
    full_name: full_name.trim(),
    temporary_pin: isTempPin,
    temporary_password: isTempPin
  };
}

/**
 * Registers a new Business and Business Owner (Self-Service Onboarding)
/**
 * Self-service Business & Owner Registration
 * Automatically grants a 90-day Free Trial of the Starter Plan (1 shop, 1 seller).
 * Eliminates payment requirement on registration so owner can log in immediately.
 */
export async function registerBusinessAndOwner(payload) {
  const {
    ownerName,
    admin_name,
    ownerPhone,
    phone_number,
    ownerEmail,
    email,
    ownerPin,
    pin,
    businessName,
    business_name,
    currencyCode = 'TZS',
    currency_code,
    planId,
    plan_id,
    termsVersion = 'v1.0',
    registrationNotes = '',
    notes
  } = payload || {};

  const resolvedOwnerName = (ownerName || admin_name || '').trim();
  const resolvedPhone = (ownerPhone || phone_number || '').trim();
  const resolvedEmail = (ownerEmail || email || '').trim();
  const resolvedPin = (ownerPin || pin || '').trim();
  const resolvedBizName = (businessName || business_name || '').trim();
  const resolvedCurrency = (currency_code || currencyCode || 'TZS').trim().toUpperCase();
  const resolvedNotes = (registrationNotes || notes || '').trim();

  if (!resolvedOwnerName || !resolvedPhone || !resolvedPin || !resolvedBizName) {
    const err = new Error('Owner name, phone number, 6-digit PIN, and business name are required.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedPhone = normalizePhoneNumber(resolvedPhone);
  if (!normalizedPhone || !isValidPhoneNumber(normalizedPhone)) {
    const err = new Error('Invalid phone number format (e.g. 0712 100 001 or +255712100001).');
    err.statusCode = 400;
    throw err;
  }

  const cleanPin = String(resolvedPin).trim();
  if (!isValidPin(cleanPin)) {
    const err = new Error('PIN must be exactly 6 numeric digits.');
    err.statusCode = 400;
    throw err;
  }

  // Verify unique collision
  const existingUser = await query(
    'SELECT id FROM users WHERE phone_number = ? OR (email IS NOT NULL AND email = ?) LIMIT 1',
    [normalizedPhone, resolvedEmail]
  );
  if (existingUser.length > 0) {
    const err = new Error('A user account with this phone number or email already exists.');
    err.statusCode = 409;
    throw err;
  }

  // Retrieve Starter plan (or explicitly selected active plan)
  let plan = null;
  const requestedPlanId = planId || plan_id;
  if (requestedPlanId) {
    try {
      const { getPlanById } = await import('./subscription.service.js');
      plan = await getPlanById(requestedPlanId);
    } catch (_) {}
  }
  if (!plan) {
    const starterPlans = await query("SELECT * FROM subscription_plans WHERE plan_code IN ('STARTER', 'STARTER_DAILY') AND is_active = TRUE ORDER BY id ASC LIMIT 1");
    if (starterPlans.length > 0) {
      plan = starterPlans[0];
    } else {
      const anyPlan = await query("SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY id ASC LIMIT 1");
      plan = anyPlan[0];
    }
  }

  // Generate clean unique business code (e.g. BIZ03)
  const countRows = await query('SELECT COUNT(*) as count FROM businesses');
  const nextNum = (countRows[0]?.count || 0) + 1;
  const businessCode = `BIZ${String(nextNum).padStart(2, '0')}`;

  const pinHash = await hashPin(cleanPin);
  const emailVal = resolvedEmail ? resolvedEmail : `${normalizedPhone.replace('+', '')}@jmsolutions.local`;
  const usernameVal = normalizedPhone;

  let newBusinessId = null;
  let newUserId = null;

  const { executeTransaction } = await import('../config/database.config.js');

  await executeTransaction(async (conn) => {
    // 1. Insert business with immediate 90-day Free Trial on Starter Plan
    const [bizResult] = await conn.query(`
      INSERT INTO businesses 
        (business_code, name, currency_code, currency_symbol, currency_name, status, subscription_plan_id, subscription_status, subscription_start_date, subscription_end_date, terms_accepted_version, terms_accepted_at, registration_notes)
      VALUES (?, ?, ?, 'TSh', 'Tanzanian Shilling', 'active', ?, 'trial', NOW(), DATE_ADD(NOW(), INTERVAL 90 DAY), ?, NOW(), ?)
    `, [
      businessCode,
      resolvedBizName,
      resolvedCurrency,
      plan?.id || null,
      termsVersion.trim(),
      resolvedNotes || 'Auto-enrolled into 90-day Free Starter Trial'
    ]);
    newBusinessId = bizResult.insertId;

    // 2. Insert owner user account (active immediately for login)
    const [userResult] = await conn.query(`
      INSERT INTO users 
        (username, email, phone_number, pin_hash, full_name, role, business_id, is_active, temporary_pin)
      VALUES (?, ?, ?, ?, ?, 'admin', ?, TRUE, FALSE)
    `, [
      usernameVal,
      emailVal,
      normalizedPhone,
      pinHash,
      resolvedOwnerName,
      newBusinessId
    ]);
    newUserId = userResult.insertId;

    // 3. Link owner_user_id back to business
    await conn.query('UPDATE businesses SET owner_user_id = ? WHERE id = ?', [newUserId, newBusinessId]);

    // 4. Provision default primary shop branch for the business
    const defaultShopCode = `SHP${String(newBusinessId).padStart(2, '0')}-01`;
    await conn.query(`
      INSERT INTO shops (business_id, shop_code, name, address, phone, currency_code, currency_symbol, currency_name, is_active)
      VALUES (?, ?, ?, 'Main Branch', ?, ?, 'TSh', 'Tanzanian Shilling', TRUE)
    `, [
      newBusinessId,
      defaultShopCode,
      `${resolvedBizName} - Main Branch`,
      normalizedPhone,
      resolvedCurrency
    ]);

    // 5. Record terms acceptance
    await conn.query(`
      INSERT INTO business_terms_acceptance (business_id, user_id, terms_version)
      VALUES (?, ?, ?)
    `, [newBusinessId, newUserId, termsVersion.trim()]);
  });

  // Record audit log
  await recordAuditEvent({
    userId: newUserId,
    action: 'BUSINESS_REGISTERED',
    targetResource: 'businesses',
    targetId: newBusinessId,
    businessId: newBusinessId,
    changes: {
      business_name: resolvedBizName,
      business_code: businessCode,
      owner_name: resolvedOwnerName,
      owner_phone: normalizedPhone,
      plan_code: plan?.plan_code || 'STARTER',
      subscription_status: 'trial',
      trial_days: 90
    }
  });

  return {
    success: true,
    message: 'Your business has been registered successfully with 90 days of Free Starter Trial. You can sign in immediately.',
    data: {
      businessId: newBusinessId,
      businessCode,
      businessName: resolvedBizName,
      status: 'active',
      subscriptionStatus: 'trial',
      trialDaysRemaining: 90,
      plan: {
        id: plan?.id,
        name: plan?.name || 'Starter Plan',
        price: plan?.price || 0,
        billing_cycle: plan?.billing_cycle || 'monthly',
        max_shops: 1,
        max_sellers: 1
      },
      owner: {
        id: newUserId,
        name: resolvedOwnerName,
        phone: normalizedPhone
      },
      canLoginImmediately: true
    }
  };
}

export default {
  getRoleDashboardRedirect,
  authenticateUser,
  refreshAccessToken,
  logoutUser,
  logoutAllSessions,
  registerUser,
  registerBusinessAndOwner
};

