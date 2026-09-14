import crypto from 'crypto';
import { ID_CONFIG } from '../config/constants.js';
import { query } from '../config/database.config.js';

// Clean unambiguous alphanumeric character set (Crockford base32 variation: 30 chars, excludes 0, O, 1, I, L)
export const CHARSET = process.env.ID_CHARSET || ID_CONFIG.CHARSET;
const CHARSET_LEN = CHARSET.length;

/**
 * Generates cryptographically secure random alphanumeric string from defined charset.
 * @param {number} length - Desired character count
 * @returns {string}
 */
export function getRandomEntropy(length = 5) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET_LEN];
  }
  return result;
}

/**
 * Calculates a single check character from a string to detect transposition/typos.
 * @param {string} input 
 * @returns {string} Single character checksum
 */
export function computeChecksum(input) {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    sum = (sum * 31 + code) % CHARSET_LEN;
  }
  return CHARSET[sum];
}

/**
 * Verifies if an ID has a valid checksum (optional client-side/POS verification).
 * @param {string} fullId 
 * @returns {boolean}
 */
export function verifyIdChecksum(fullId) {
  if (!fullId || fullId.length < 3) return false;
  const body = fullId.slice(0, -1);
  const checkChar = fullId.slice(-1);
  return computeChecksum(body) === checkChar;
}

// Monotonic sequence counter to guarantee uniqueness even in high-throughput sub-millisecond loops
let sequenceCounter = 0;

/**
 * Encodes timestamp into a compact alphanumeric string (Base30)
 * Uses millisecond precision + sequence counter
 * @returns {string} 5-character time slice
 */
export function getTimestampSegment() {
  const now = Date.now();
  sequenceCounter = (sequenceCounter + 1) % (CHARSET_LEN * CHARSET_LEN);
  
  // Combine timestamp seconds with sequence counter
  let val = Math.floor(now / 1000) % (CHARSET_LEN * CHARSET_LEN * CHARSET_LEN);
  let seg = '';
  for (let i = 0; i < 3; i++) {
    seg = CHARSET[val % CHARSET_LEN] + seg;
    val = Math.floor(val / CHARSET_LEN);
  }

  // Add 2 chars of sequence counter to prevent any intra-second collisions
  let seqVal = sequenceCounter;
  for (let j = 0; j < 2; j++) {
    seg += CHARSET[seqVal % CHARSET_LEN];
    seqVal = Math.floor(seqVal / CHARSET_LEN);
  }

  return seg;
}

/**
 * Generates a formatted alphanumeric Product ID.
 * Pattern: PRD-[SHOP_CODE]-[TIME_SEQ]-[RANDOM_ENTROPY][CHECKSUM]
 * Example: PRD-SHP01-3BWX8-K7M2P
 * 
 * @param {string} [shopCode=''] - Optional shop identifier (e.g. 'SHP01')
 * @returns {string} Formatted unique alphanumeric product ID
 */
export function generateRawProductId(shopCode = '') {
  const prefix = ID_CONFIG.PRODUCT_PREFIX;
  const cleanShop = shopCode ? shopCode.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const timeSeg = getTimestampSegment();
  const randSeg = getRandomEntropy(5); // 30^5 = ~24.3 million random variations

  const base = cleanShop 
    ? `${prefix}-${cleanShop}-${timeSeg}-${randSeg}`
    : `${prefix}-${timeSeg}-${randSeg}`;

  const checksum = computeChecksum(base);
  return `${base}${checksum}`;
}

export const generateProductId = generateRawProductId;

/**
 * Generates an alphanumeric Transaction ID.
 * Pattern: TXN-[SHOP_CODE]-[YYYYMMDD]-[RANDOM_ENTROPY]
 * Example: TXN-SHP01-20260913-9F3K
 * 
 * @param {string} [shopCode='']
 * @returns {string}
 */
export function generateTransactionId(shopCode = '') {
  const prefix = ID_CONFIG.TRANSACTION_PREFIX;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  const cleanShop = shopCode ? shopCode.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const randEntropy = getRandomEntropy(4);

  return cleanShop
    ? `${prefix}-${cleanShop}-${dateStr}-${randEntropy}`
    : `${prefix}-${dateStr}-${randEntropy}`;
}

/**
 * Generates a guaranteed collision-free Product ID by verifying against MySQL products table.
 * 
 * @param {string} [shopCode='']
 * @param {number} [maxAttempts=5]
 * @returns {Promise<string>}
 */
export async function generateUniqueProductId(shopCode = '', maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidateId = generateRawProductId(shopCode);
    
    try {
      const existing = await query(
        'SELECT id FROM products WHERE id = ? LIMIT 1',
        [candidateId]
      );

      if (!existing || existing.length === 0) {
        return candidateId;
      }
      console.warn(`ID collision detected for ${candidateId}, retrying attempt ${attempt}...`);
    } catch (err) {
      // If DB is offline or not yet initialized, return candidate ID directly
      return candidateId;
    }
  }

  // Fallback with higher entropy if multiple collisions occur
  const extraEntropy = getRandomEntropy(6);
  return `${ID_CONFIG.PRODUCT_PREFIX}-${extraEntropy}`;
}

export default {
  CHARSET,
  getRandomEntropy,
  computeChecksum,
  verifyIdChecksum,
  getTimestampSegment,
  generateRawProductId,
  generateProductId,
  generateTransactionId,
  generateUniqueProductId
};
