/**
 * Token Lifecycle & Cryptographic Utility
 * Handles short-lived 15-minute Access Tokens and secure 7-day Refresh Tokens
 * with SHA-256 hashing and zero-downtime secret rotation support.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const CURRENT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'pos_ecommerce_access_secret_2026';
const OLD_ACCESS_SECRET = process.env.OLD_JWT_SECRET || null;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';

// Refresh tokens expire in 7 days (in milliseconds)
export const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Issues a short-lived 15-minute Access Token containing minimal JWT claims.
 * Stored exclusively in client runtime application memory (React state).
 * 
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.role
 * @param {number|null} params.businessId
 * @param {number|null} params.shopId
 * @param {string} params.sessionId
 * @returns {string} Signed JWT Access Token
 */
export function issueAccessToken({ userId, role, businessId, shopId, sessionId }) {
  const payload = {
    id: userId,
    role,
    business_id: businessId,
    shop_id: shopId,
    session_id: sessionId
  };

  return jwt.sign(payload, CURRENT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    issuer: 'pos-ecommerce-api',
    audience: 'pos-ecommerce-client'
  });
}

/**
 * Verifies an Access Token with secret rotation support.
 * Checks against CURRENT_ACCESS_SECRET first; if verification fails and OLD_ACCESS_SECRET
 * is configured, falls back to OLD_ACCESS_SECRET before throwing.
 * 
 * @param {string} token
 * @returns {object} Decoded JWT payload
 */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, CURRENT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'pos-ecommerce-api',
      audience: 'pos-ecommerce-client'
    });
  } catch (err) {
    if (OLD_ACCESS_SECRET && err.name === 'JsonWebTokenError') {
      try {
        return jwt.verify(token, OLD_ACCESS_SECRET, {
          algorithms: ['HS256'],
          issuer: 'pos-ecommerce-api',
          audience: 'pos-ecommerce-client'
        });
      } catch {
        // Fall through to throw original error
      }
    }
    throw err;
  }
}

/**
 * Generates an opaque, cryptographically secure 7-day Refresh Token.
 * Returned to the client exclusively via HTTP-only cookie.
 * 
 * @returns {string} 96-character hex token
 */
export function generateRawRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Produces a deterministic SHA-256 fingerprint of a refresh token.
 * Only this hash is stored in the database, ensuring database compromise
 * cannot expose usable refresh credentials.
 * 
 * @param {string} rawToken
 * @returns {string} 64-character SHA-256 hex digest
 */
export function hashRefreshToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return '';
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Generates a unique Token Family ID for grouping rotating refresh tokens.
 * @returns {string}
 */
export function generateTokenFamilyId() {
  return `fam_${crypto.randomUUID()}`;
}

/**
 * Generates a unique Session ID.
 * @returns {string}
 */
export function generateSessionId() {
  return `sess_${crypto.randomUUID()}`;
}

// Aliases
export const generateAccessToken = (params) => {
  if (params && params.id && !params.userId) {
    return issueAccessToken({
      userId: params.id,
      role: params.role,
      businessId: params.business_id || params.businessId,
      shopId: params.shop_id || params.shopId,
      sessionId: params.session_id || params.sessionId
    });
  }
  return issueAccessToken(params);
};
export const generateOpaqueRefreshToken = generateRawRefreshToken;

export default {
  issueAccessToken,
  generateAccessToken,
  verifyAccessToken,
  generateRawRefreshToken,
  generateOpaqueRefreshToken,
  hashRefreshToken,
  generateTokenFamilyId,
  generateSessionId,
  REFRESH_TOKEN_LIFETIME_MS
};
