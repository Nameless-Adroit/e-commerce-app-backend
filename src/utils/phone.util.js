/**
 * Phone Number Normalization & Validation Utility
 * Specialized for Tanzanian deployment with standard E.164 normalization.
 */

// Tanzanian mobile operator prefixes (without leading 0 or +255)
// 74, 75, 76 (Vodacom)
// 78, 68, 69 (Airtel)
// 71, 65, 67, 77 (Tigo / Yas)
// 62, 61 (Halotel)
// 73 (TTCL)
const TZ_MOBILE_REGEX = /^\+255[67]\d{8}$/;

/**
 * Normalizes any phone number representation to canonical E.164 format.
 * Examples:
 *   "0712345678"        -> "+255712345678"
 *   "255712345678"      -> "+255712345678"
 *   "+255 712 345 678"  -> "+255712345678"
 *   "0712-345-678"      -> "+255712345678"
 * 
 * @param {string} rawPhone
 * @returns {string|null} Normalized E.164 phone string, or null if input is invalid
 */
export function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;

  // 1. Strip all non-digit characters except leading plus
  let cleaned = rawPhone.trim().replace(/[^\d+]/g, '');

  if (!cleaned) return null;

  // 2. Handle Tanzanian local format (starts with 0, e.g. 07XXXXXXXX or 06XXXXXXXX)
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    if (cleaned[1] !== '6' && cleaned[1] !== '7') return null;
    cleaned = '+255' + cleaned.slice(1);
  }

  // 3. Handle 255 without leading plus (e.g. 2557XXXXXXXX or 2556XXXXXXXX)
  if (cleaned.startsWith('255') && cleaned.length === 12) {
    if (cleaned[3] !== '6' && cleaned[3] !== '7') return null;
    cleaned = '+' + cleaned;
  }

  // 4. Ensure has leading plus if numeric only and 9 digits starting with 7 or 6
  if (!cleaned.startsWith('+') && cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('6'))) {
    cleaned = '+255' + cleaned;
  }

  // Validate canonical format
  if (cleaned.startsWith('+255')) {
    if (!TZ_MOBILE_REGEX.test(cleaned)) return null;
  } else if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Validates whether a phone number is a valid mobile number for application accounts.
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidPhoneNumber(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return false;

  // Check Tanzania format: +255 followed by 9 digits starting with 6 or 7
  if (TZ_MOBILE_REGEX.test(normalized)) {
    return true;
  }

  // Fallback check for general international E.164 (+ followed by 8 to 15 digits)
  return /^\+[1-9]\d{7,14}$/.test(normalized);
}

/**
 * Formats a normalized E.164 phone number into a user-friendly display string.
 * Example: "+255712345678" -> "+255 712 345 678"
 * @param {string} phone
 * @returns {string}
 */
export function formatPhoneNumber(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return phone || '';

  if (normalized.startsWith('+255') && normalized.length === 13) {
    const country = normalized.slice(0, 4);
    const prefix = normalized.slice(4, 7);
    const mid = normalized.slice(7, 10);
    const end = normalized.slice(10, 13);
    return `${country} ${prefix} ${mid} ${end}`;
  }

  return normalized;
}
/**
 * Determines Tanzanian mobile network operator based on MSISDN prefix.
 * @param {string} phone
 * @returns {string} Operator name or 'Unknown'
 */
export function getTanzanianOperator(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized || !normalized.startsWith('+255')) return 'Unknown';

  const prefix = normalized.slice(4, 6);
  if (['74', '75', '76'].includes(prefix)) return 'Vodacom';
  if (['78', '68', '69'].includes(prefix)) return 'Airtel';
  if (['71', '65', '67', '77'].includes(prefix)) return 'Tigo';
  if (['62', '61'].includes(prefix)) return 'Halotel';
  if (prefix === '73') return 'TTCL';

  return 'Unknown';
}

// Aliases for comprehensive backwards/test compatibility
export const normalizeTanzanianPhone = normalizePhoneNumber;
export const isValidTanzanianPhone = isValidPhoneNumber;

export default {
  normalizePhoneNumber,
  normalizeTanzanianPhone,
  isValidPhoneNumber,
  isValidTanzanianPhone,
  formatPhoneNumber,
  getTanzanianOperator
};
