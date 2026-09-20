/**
 * Input Validation Middleware
 * Enforces unified backend validation across sensitive authentication and profile endpoints.
 */
import { isValidPhoneNumber, normalizePhoneNumber } from '../utils/phone.util.js';
import { isValidPin } from '../utils/pin.util.js';
import { ROLES } from '../config/constants.js';

/**
 * Validates Login payload:
 * Accepts either:
 *  - { phoneNumber, pin } for Store Admin & Seller
 *  - { identifier, password } for Super Admin
 */
export function validateLoginPayload(req, res, next) {
  const { phoneNumber, pin, identifier, password, username, email } = req.body;

  const rawId = (phoneNumber || identifier || username || email || '').trim();
  const rawSecret = (pin || password || '').trim();

  if (!rawId || !rawSecret) {
    return res.status(400).json({
      success: false,
      message: 'Credentials required. Please enter your phone number or username, and PIN or password.'
    });
  }

  // Check if it's formatted as a phone number
  const normalized = normalizePhoneNumber(rawId);
  if (normalized && isValidPhoneNumber(normalized)) {
    req.body.normalizedPhone = normalized;
  }

  req.body.loginIdentifier = rawId;
  req.body.loginSecret = rawSecret;
  next();
}

/**
 * Validates PIN Change / Reset payload
 */
export function validatePinPayload(req, res, next) {
  const { pin, newPin, oldPin } = req.body;
  const targetPin = newPin || pin;

  if (!targetPin || !isValidPin(targetPin)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid PIN. PIN must be between 4 and 6 numeric digits.'
    });
  }

  if (oldPin && !isValidPin(oldPin)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid current PIN.'
    });
  }

  next();
}

/**
 * Validates User Profile Update payload
 */
export function validateProfileUpdate(req, res, next) {
  const { full_name, phone_number, profile_image } = req.body;

  if (full_name !== undefined) {
    if (typeof full_name !== 'string' || full_name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Full name must be at least 2 characters long.'
      });
    }
    req.body.full_name = full_name.trim();
  }

  if (phone_number !== undefined && phone_number !== null && phone_number !== '') {
    const normalized = normalizePhoneNumber(phone_number);
    if (!normalized || !isValidPhoneNumber(normalized)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please provide a valid phone number.'
      });
    }
    req.body.phone_number = normalized;
  }

  if (profile_image !== undefined && profile_image !== null && profile_image !== '') {
    if (typeof profile_image !== 'string' || profile_image.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Profile image reference cannot exceed 500 characters.'
      });
    }
    // Prevent dangerous protocols
    if (profile_image.startsWith('javascript:') || profile_image.startsWith('data:text/html')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image format or protocol.'
      });
    }
  }

  next();
}

export default {
  validateLoginPayload,
  validatePinPayload,
  validateProfileUpdate
};
