/**
 * Input Validation Middleware
 * Enforces unified backend validation across sensitive authentication and profile endpoints.
 */
import { isValidPhoneNumber, normalizePhoneNumber } from '../utils/phone.util.js';
import { isValidPin } from '../utils/pin.util.js';
import { ROLES } from '../config/constants.js';

/**
 * Validates Login payload:
 * Strictly enforces:
 *  - phoneNumber: Valid E.164 phone number (+255XXXXXXXXX or 07XXXXXXXX)
 *  - pin: Exactly 6 numeric digits
 */
export function validateLoginPayload(req, res, next) {
  const { phoneNumber, pin, identifier, secret } = req.body;

  const rawPhone = (phoneNumber || identifier || '').trim();
  const rawPin = (pin || secret || '').trim();

  if (!rawPhone || !rawPin) {
    return res.status(400).json({
      success: false,
      message: 'Please provide your phone number and 6-digit PIN.'
    });
  }

  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized || !isValidPhoneNumber(normalized)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid phone number format. Please provide a valid phone number (e.g. 0712 100 001 or +255712100001).'
    });
  }

  if (!isValidPin(rawPin)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid PIN. PIN must be exactly 6 numeric digits.'
    });
  }

  req.body.normalizedPhone = normalized;
  req.body.phoneNumber = normalized;
  req.body.pin = rawPin;
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
      message: 'Invalid PIN. PIN must be exactly 6 numeric digits.'
    });
  }

  if (oldPin && !isValidPin(oldPin)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid current PIN. PIN must be exactly 6 numeric digits.'
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
