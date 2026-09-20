/**
 * Security Service: Brute-Force Protection, Progressive Delays & Security Logging
 * Ensures accounts cannot be enumerated or brute-forced and keeps structured audit trails.
 */
import { query } from '../config/database.config.js';

const MAX_FAILED_ATTEMPTS = parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS, 10) || 5;
const LOCKOUT_DURATION_MS = parseInt(process.env.AUTH_LOCKOUT_DURATION_MS, 10) || 15 * 60 * 1000;

// In-memory IP-based tracker to thwart distributed credential stuffing
const ipAttemptTracker = new Map();

/**
 * Checks whether an identifier or IP address is currently locked out.
 * 
 * @param {string} identifier (phone number, username, or email)
 * @param {string} ipAddress
 * @returns {Promise<void>} Throws 429 if locked out
 */
export async function checkBruteForceLockout(identifier, ipAddress) {
  // 1. Check IP tracker
  if (ipAddress) {
    const ipData = ipAttemptTracker.get(ipAddress);
    if (ipData && ipData.lockedUntil && ipData.lockedUntil > Date.now()) {
      const waitSeconds = Math.ceil((ipData.lockedUntil - Date.now()) / 1000);
      const err = new Error(`Too many authentication failures from this network. Please retry in ${waitSeconds} seconds.`);
      err.statusCode = 429;
      throw err;
    }
  }

  // 2. Check Database record for user identifier
  if (identifier) {
    const users = await query(
      `SELECT id, failed_login_attempts, locked_until 
       FROM users 
       WHERE (phone_number = ? OR username = ? OR email = ?) LIMIT 1`,
      [identifier, identifier, identifier]
    );

    if (users && users.length > 0) {
      const user = users[0];
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const waitMinutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
        const err = new Error(`Account temporarily locked due to consecutive failed attempts. Please try again in ${waitMinutes} minute(s).`);
        err.statusCode = 429;
        throw err;
      }
    }
  }
}

/**
 * Records a failed authentication attempt, applies progressive delay, and locks if threshold reached.
 * 
 * @param {object} params
 * @param {string} params.identifier
 * @param {string|null} params.ipAddress
 * @param {string|null} params.userAgent
 * @returns {Promise<void>}
 */
export async function handleFailedLoginAttempt({ identifier, ipAddress, userAgent }) {
  // 1. Update IP Tracker
  if (ipAddress) {
    const now = Date.now();
    const current = ipAttemptTracker.get(ipAddress) || { count: 0, firstAttempt: now, lockedUntil: null };
    
    // Reset window after 1 hour of quiet
    if (now - current.firstAttempt > 60 * 60 * 1000) {
      current.count = 1;
      current.firstAttempt = now;
      current.lockedUntil = null;
    } else {
      current.count += 1;
    }

    if (current.count >= MAX_FAILED_ATTEMPTS * 3) {
      current.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    ipAttemptTracker.set(ipAddress, current);
  }

  // 2. Update Database user attempts if account exists
  let failedCount = 1;
  let isLocked = false;

  if (identifier) {
    const users = await query(
      `SELECT id, failed_login_attempts FROM users 
       WHERE (phone_number = ? OR username = ? OR email = ?) LIMIT 1`,
      [identifier, identifier, identifier]
    );

    if (users && users.length > 0) {
      const user = users[0];
      failedCount = (user.failed_login_attempts || 0) + 1;

      if (failedCount >= MAX_FAILED_ATTEMPTS) {
        isLocked = true;
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        await query(
          'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
          [failedCount, lockUntil, user.id]
        );

        await recordSecurityEvent({
          eventType: 'AUTH_LOCKOUT',
          userId: user.id,
          identifier,
          ipAddress,
          userAgent,
          details: { failedCount, lockUntil }
        });
      } else {
        await query(
          'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
          [failedCount, user.id]
        );
      }
    }
  }

  await recordSecurityEvent({
    eventType: 'LOGIN_FAILED',
    userId: null,
    identifier,
    ipAddress,
    userAgent,
    details: { attempts: failedCount, isLocked }
  });

  // Progressive delay (timing attack mitigation & throttling)
  if (failedCount >= 2) {
    const delayMs = Math.min(failedCount * 300, 2000);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

/**
 * Resets failed attempts counter upon successful login.
 * 
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.identifier
 * @param {string|null} params.ipAddress
 * @param {string|null} params.userAgent
 */
export async function handleSuccessfulLogin({ userId, identifier, ipAddress, userAgent }) {
  if (ipAddress) {
    ipAttemptTracker.delete(ipAddress);
  }

  if (userId) {
    await query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [userId]
    );
  }

  await recordSecurityEvent({
    eventType: 'LOGIN_SUCCESS',
    userId,
    identifier,
    ipAddress,
    userAgent
  });
}

/**
 * Sanitizes details to ensure credentials/tokens/secrets are never logged.
 * 
 * @param {object|null} details
 * @returns {object|null}
 */
function sanitizeSecurityDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const sanitized = { ...details };
  const sensitiveKeys = ['password', 'pin', 'token', 'secret', 'authorization', 'hash', 'password_hash', 'pin_hash'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

/**
 * Writes a structured entry to security_logs.
 * 
 * @param {object} params
 * @param {string} params.eventType
 * @param {number|null} params.userId
 * @param {string|null} params.identifier
 * @param {string|null} params.ipAddress
 * @param {string|null} params.userAgent
 * @param {object|null} params.details
 */
export async function recordSecurityEvent({ eventType, userId = null, identifier = null, ipAddress = null, userAgent = null, details = null }) {
  try {
    const safeDetails = sanitizeSecurityDetails(details);
    const jsonStr = safeDetails ? JSON.stringify(safeDetails) : null;

    await query(
      `INSERT INTO security_logs (event_type, user_id, identifier, ip_address, user_agent, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        userId || null,
        identifier || null,
        ipAddress || null,
        userAgent ? userAgent.slice(0, 255) : null,
        jsonStr
      ]
    );
  } catch (err) {
    // Non-blocking: security logging failure should not crash request processing
    console.error('Failed to write security log:', err.message);
  }
}

/**
 * Resets the failed attempts counter and lockout status for a user.
 * 
 * @param {number} userId
 */
export async function resetFailedAttempts(userId) {
  await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
    [userId]
  );
}

/**
 * Checks if an account is locked out based on user ID.
 * 
 * @param {number} userId
 * @returns {Promise<{ locked: boolean, remainingMinutes: number, lockoutMinutes: number }>}
 */
export async function checkAccountLockout(userId) {
  const rows = await query('SELECT locked_until FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!rows || rows.length === 0) return { locked: false, remainingMinutes: 0, lockoutMinutes: 0 };
  const lockedUntil = rows[0].locked_until ? new Date(rows[0].locked_until) : null;
  const now = new Date();
  if (lockedUntil && lockedUntil > now) {
    const remainingMinutes = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000);
    return { locked: true, remainingMinutes, lockoutMinutes: remainingMinutes };
  }
  return { locked: false, remainingMinutes: 0, lockoutMinutes: 0 };
}

/**
 * Records a failed login attempt directly for a user ID.
 * 
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.identifier
 * @param {string} [params.reason]
 * @param {string} [params.ipAddress]
 * @returns {Promise<{ locked: boolean, failedCount: number, lockoutMinutes: number }>}
 */
export async function recordFailedAttempt({ userId, identifier, reason, ipAddress }) {
  await query('UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = ?', [userId]);
  const rows = await query('SELECT failed_login_attempts FROM users WHERE id = ?', [userId]);
  const count = rows[0]?.failed_login_attempts || 1;
  const maxAttempts = parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS, 10) || 5;
  const lockoutDurationMs = parseInt(process.env.AUTH_LOCKOUT_DURATION_MS, 10) || 15 * 60 * 1000;

  if (count >= maxAttempts) {
    const lockUntil = new Date(Date.now() + lockoutDurationMs);
    await query('UPDATE users SET locked_until = ? WHERE id = ?', [lockUntil, userId]);
    return { locked: true, failedCount: count, lockoutMinutes: Math.ceil(lockoutDurationMs / 60000) };
  }
  return { locked: false, failedCount: count, lockoutMinutes: 0 };
}

export default {
  checkBruteForceLockout,
  handleFailedLoginAttempt,
  handleSuccessfulLogin,
  recordSecurityEvent,
  resetFailedAttempts,
  checkAccountLockout,
  recordFailedAttempt
};
