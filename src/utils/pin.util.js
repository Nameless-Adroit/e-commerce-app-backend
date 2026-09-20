/**
 * PIN Policy, Validation & Hashing Utility
 * Enforces secure 4-6 digit numeric credentials for Shop Admins and Sellers.
 */
import bcrypt from 'bcryptjs';

const PIN_REGEX = /^\d{4,6}$/;
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Validates whether a raw PIN satisfies the system PIN policy:
 * - Must be a string of exactly 4 to 6 numeric digits
 * - Rejects non-numeric characters, spaces, and empty values
 * 
 * @param {string} pin
 * @returns {boolean}
 */
export function isValidPin(pin) {
  if (!pin || typeof pin !== 'string') return false;
  return PIN_REGEX.test(pin.trim());
}

/**
 * Securely hashes a numeric PIN using bcrypt with 10 salt rounds.
 * NEVER stores or logs the plaintext PIN.
 * 
 * @param {string} pin
 * @returns {Promise<string>} Bcrypt hash
 */
export async function hashPin(pin) {
  if (!isValidPin(pin)) {
    const err = new Error('Invalid PIN. PIN must be between 4 and 6 numeric digits.');
    err.statusCode = 400;
    throw err;
  }
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(pin.trim(), salt);
}

/**
 * Constant-time comparison of a submitted PIN against a stored bcrypt hash.
 * 
 * @param {string} submittedPin
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPin(submittedPin, storedHash) {
  if (!submittedPin || !storedHash || !isValidPin(submittedPin)) {
    return false;
  }
  return bcrypt.compare(submittedPin.trim(), storedHash);
}

export default {
  isValidPin,
  hashPin,
  verifyPin
};
