import * as authService from '../services/auth.service.js';

/**
 * Unified Login Portal (SRS 3.1)
 */
export async function login(req, res, next) {
  try {
    const result = await authService.authenticateUser(req.body);
    res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get current authenticated user profile
 */
export async function getProfile(req, res, next) {
  try {
    const profile = await authService.getUserProfile(req.user.id);
    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new user (Restricted to Super Admin or Shop Admin)
 */
export async function registerUser(req, res, next) {
  try {
    const newUser = await authService.registerUser({
      currentUser: req.user,
      userData: req.body
    });

    res.status(201).json({
      success: true,
      message: 'User successfully created.',
      data: newUser
    });
  } catch (err) {
    next(err);
  }
}

export default {
  login,
  getProfile,
  registerUser
};
