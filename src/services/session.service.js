/**
 * Session Management & Token Rotation Service
 * Enforces server-side device tracking, refresh token rotation, and reuse detection.
 */
import { query } from '../config/database.config.js';
import { 
  generateSessionId, 
  generateTokenFamilyId, 
  generateRawRefreshToken, 
  hashRefreshToken,
  REFRESH_TOKEN_LIFETIME_MS 
} from '../utils/token.util.js';
import { recordSecurityEvent } from './security.service.js';
import { ROLES, BUSINESS_STATUS } from '../config/constants.js';

// In-memory registry of rotated refresh token hashes to immediately catch token reuse
const rotatedTokensTracker = new Map();

/**
 * Creates a new authenticated device session.
 * 
 * @param {object} params
 * @param {number} params.userId
 * @param {string|null} params.deviceName
 * @param {string|null} params.deviceId
 * @param {string|null} params.ipAddress
 * @param {string|null} params.userAgent
 * @returns {Promise<{ sessionId: string, tokenFamilyId: string, rawRefreshToken: string, expiresAt: Date }>}
 */
export async function createSession({ userId, deviceName, deviceId, ipAddress, userAgent }) {
  const sessionId = generateSessionId();
  const tokenFamilyId = generateTokenFamilyId();
  const rawRefreshToken = generateRawRefreshToken();
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS);

  await query(
    `INSERT INTO sessions 
      (id, user_id, token_family_id, refresh_token_hash, device_name, device_id, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      userId,
      tokenFamilyId,
      refreshTokenHash,
      deviceName || 'Unknown Device',
      deviceId || null,
      ipAddress || null,
      userAgent ? userAgent.slice(0, 255) : null,
      expiresAt
    ]
  );

  await recordSecurityEvent({
    eventType: 'SESSION_CREATED',
    userId,
    ipAddress,
    userAgent,
    details: { sessionId, tokenFamilyId, deviceName }
  });

  return {
    sessionId,
    session: {
      id: sessionId,
      user_id: userId,
      userId,
      token_family_id: tokenFamilyId,
      expires_at: expiresAt
    },
    tokenFamilyId,
    rawRefreshToken,
    expiresAt
  };
}

/**
 * Rotates a refresh token upon successful verification.
 * Enforces automatic reuse detection: if a previously rotated or revoked token is reused,
 * revokes the entire token family immediately as a potential session hijack.
 * 
 * @param {object} params
 * @param {string} params.rawRefreshToken
 * @param {string|null} params.ipAddress
 * @param {string|null} params.userAgent
 * @returns {Promise<{ session: object, newRawRefreshToken: string, expiresAt: Date }>}
 */
export async function rotateSessionToken({ rawRefreshToken, ipAddress, userAgent }) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    const err = new Error('Refresh token is required.');
    err.statusCode = 400;
    throw err;
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);

  // 1. Look up session by active refresh token hash
  const sessions = await query(
    `SELECT s.*, u.role, u.business_id, u.shop_id, u.is_active, u.username, u.full_name,
            b.status as business_status, b.subscription_status
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN businesses b ON u.business_id = b.id
     WHERE s.refresh_token_hash = ? LIMIT 1`,
    [tokenHash]
  );

  // 2. If no active session matches this hash, inspect if it belongs to a compromised or already-rotated family
  if (!sessions || sessions.length === 0) {
    const reuseEntry = rotatedTokensTracker.get(tokenHash);

    if (reuseEntry) {
      if (reuseEntry.tokenFamilyId) {
        await query(
          'UPDATE sessions SET is_revoked = TRUE, revoke_reason = "family_reuse_detected" WHERE token_family_id = ? OR id = ?',
          [reuseEntry.tokenFamilyId, reuseEntry.sessionId]
        );
      } else if (reuseEntry.sessionId) {
        await query(
          'UPDATE sessions SET is_revoked = TRUE, revoke_reason = "family_reuse_detected" WHERE id = ?',
          [reuseEntry.sessionId]
        );
      }

      await recordSecurityEvent({
        eventType: 'TOKEN_REFRESH_REUSE',
        userId: reuseEntry.userId,
        ipAddress,
        userAgent,
        details: { tokenHashPrefix: tokenHash.slice(0, 16), tokenFamilyId: reuseEntry.tokenFamilyId }
      });

      const err = new Error('Token reuse detected. Session revoked for security.');
      err.statusCode = 401;
      throw err;
    }

    const pastLogs = await query(
      `SELECT * FROM security_logs 
       WHERE event_type = 'TOKEN_REFRESH' 
         AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.previousTokenHash')) = ? 
       ORDER BY id DESC LIMIT 1`,
      [tokenHash]
    );

    if (pastLogs && pastLogs.length > 0) {
      const logDetails = typeof pastLogs[0].details === 'string' 
        ? JSON.parse(pastLogs[0].details) 
        : pastLogs[0].details;
      
      const compromisedFamilyId = logDetails?.tokenFamilyId;
      const compromisedSessionId = logDetails?.sessionId;

      if (compromisedFamilyId) {
        await query(
          'UPDATE sessions SET is_revoked = TRUE, revoke_reason = "family_reuse_detected" WHERE token_family_id = ?',
          [compromisedFamilyId]
        );
      } else if (compromisedSessionId) {
        await query(
          'UPDATE sessions SET is_revoked = TRUE, revoke_reason = "family_reuse_detected" WHERE id = ?',
          [compromisedSessionId]
        );
      }

      await recordSecurityEvent({
        eventType: 'TOKEN_REFRESH_REUSE',
        userId: pastLogs[0].user_id,
        ipAddress,
        userAgent,
        details: { tokenHashPrefix: tokenHash.slice(0, 16), tokenFamilyId: compromisedFamilyId }
      });

      const err = new Error('Token reuse detected. Session revoked for security.');
      err.statusCode = 401;
      throw err;
    }

    await recordSecurityEvent({
      eventType: 'TOKEN_REFRESH_REUSE',
      userId: null,
      ipAddress,
      userAgent,
      details: { attemptedTokenHashPrefix: tokenHash.slice(0, 16) }
    });

    const err = new Error('Invalid authentication session. Please sign in again.');
    err.statusCode = 401;
    throw err;
  }

  const session = sessions[0];

  // 3. Verify user active status
  if (!session.is_active) {
    await revokeSession(session.id, 'user_account_deactivated');
    const err = new Error('User account is deactivated.');
    err.statusCode = 403;
    throw err;
  }

  // 4. Verify business active status
  if (session.role !== ROLES.SUPER_ADMIN && session.business_status === BUSINESS_STATUS.SUSPENDED) {
    await revokeSession(session.id, 'business_suspended');
    const err = new Error('Business account has been suspended.');
    err.statusCode = 403;
    throw err;
  }

  // 5. Verify session not revoked
  if (session.is_revoked) {
    // Critical: A revoked token is being presented! Revoke entire family to stop attacker.
    await query(
      'UPDATE sessions SET is_revoked = TRUE, revoke_reason = "family_reuse_detected" WHERE token_family_id = ?',
      [session.token_family_id]
    );

    await recordSecurityEvent({
      eventType: 'TOKEN_REFRESH_REUSE',
      userId: session.user_id,
      ipAddress,
      userAgent,
      details: { sessionId: session.id, familyId: session.token_family_id }
    });

    const err = new Error('Session has been revoked due to security policy. Please sign in again.');
    err.statusCode = 401;
    throw err;
  }

  // 5. Verify expiration
  const now = new Date();
  if (new Date(session.expires_at) <= now) {
    await revokeSession(session.id, 'session_expired');
    const err = new Error('Session expired. Please sign in again.');
    err.statusCode = 401;
    throw err;
  }

  // 6. Rotate: generate new refresh token and update session
  const newRawRefreshToken = generateRawRefreshToken();
  const newHash = hashRefreshToken(newRawRefreshToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS);

  await query(
    `UPDATE sessions 
     SET refresh_token_hash = ?,
         last_used_at = CURRENT_TIMESTAMP,
         expires_at = ?,
         ip_address = COALESCE(?, ip_address),
         user_agent = COALESCE(?, user_agent)
     WHERE id = ?`,
    [
      newHash,
      newExpiresAt,
      ipAddress || null,
      userAgent ? userAgent.slice(0, 255) : null,
      session.id
    ]
  );

  // Track previous token hash to thwart token replay attacks
  rotatedTokensTracker.set(tokenHash, {
    sessionId: session.id,
    tokenFamilyId: session.token_family_id,
    userId: session.user_id,
    rotatedAt: Date.now()
  });

  await recordSecurityEvent({
    eventType: 'TOKEN_REFRESH',
    userId: session.user_id,
    ipAddress,
    userAgent,
    details: { 
      sessionId: session.id,
      previousTokenHash: tokenHash,
      tokenFamilyId: session.token_family_id
    }
  });

  return {
    session: {
      id: session.id,
      userId: session.user_id,
      role: session.role,
      businessId: session.business_id,
      shopId: session.shop_id,
      username: session.username,
      fullName: session.full_name
    },
    newRawRefreshToken,
    expiresAt: newExpiresAt
  };
}

/**
 * Revokes a specific authenticated session.
 * 
 * @param {string} sessionId
 * @param {string} reason
 */
export async function revokeSession(sessionId, reason = 'user_logout') {
  await query(
    'UPDATE sessions SET is_revoked = TRUE, revoke_reason = ? WHERE id = ?',
    [reason, sessionId]
  );

  await recordSecurityEvent({
    eventType: 'SESSION_REVOKED',
    userId: null,
    details: { sessionId, reason }
  });
}

/**
 * Revokes all active sessions for a given user (Logout All Devices).
 * 
 * @param {number} userId
 * @param {string} reason
 */
export async function revokeAllUserSessions(userId, reason = 'logout_all') {
  await query(
    'UPDATE sessions SET is_revoked = TRUE, revoke_reason = ? WHERE user_id = ? AND is_revoked = FALSE',
    [reason, userId]
  );

  await recordSecurityEvent({
    eventType: 'LOGOUT_ALL',
    userId,
    details: { reason }
  });
}

/**
 * Lists all active (non-revoked, unexpired) sessions for a user.
 * Tokens and hashes are NEVER returned.
 * 
 * @param {number} userId
 * @param {string} currentSessionId
 * @returns {Promise<Array<object>>}
 */
export async function getUserActiveSessions(userId, currentSessionId = null) {
  const sessions = await query(
    `SELECT id, device_name, device_id, ip_address, created_at, last_used_at, expires_at
     FROM sessions
     WHERE user_id = ? AND is_revoked = FALSE AND expires_at > CURRENT_TIMESTAMP
     ORDER BY last_used_at DESC`,
    [userId]
  );

  return sessions.map(s => ({
    id: s.id,
    deviceName: s.device_name,
    deviceId: s.device_id,
    ipAddress: s.ip_address,
    createdAt: s.created_at,
    lastUsedAt: s.last_used_at,
    expiresAt: s.expires_at,
    isCurrent: s.id === currentSessionId
  }));
}

/**
 * Finds a session record by its primary key ID.
 * 
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function findSessionById(sessionId) {
  const rows = await query('SELECT * FROM sessions WHERE id = ? LIMIT 1', [sessionId]);
  return rows && rows.length > 0 ? rows[0] : null;
}

export default {
  createSession,
  rotateSessionToken,
  revokeSession,
  revokeAllUserSessions,
  getUserActiveSessions,
  findSessionById
};
