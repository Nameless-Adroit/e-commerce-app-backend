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

/**
 * Change password for authenticated user
 */
export async function changePassword(req, res, next) {
  try {
    const { old_password, oldPassword, new_password, newPassword } = req.body;
    const result = await authService.changePassword({
      userId: req.user.id,
      oldPassword: old_password || oldPassword,
      newPassword: new_password || newPassword
    });

    res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Super Admin resets user/admin credentials with temporary password
 */
export async function resetPassword(req, res, next) {
  try {
    const { new_password, newPassword } = req.body;
    const targetUserId = req.params.id;

    const result = await authService.resetPassword({
      targetUserId,
      newPassword: new_password || newPassword,
      currentUser: req.user
    });

    res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Suspend or reactivate user account
 */
export async function setUserStatus(req, res, next) {
  try {
    const targetUserId = req.params.id;
    const { is_active } = req.body;

    const result = await authService.setUserActiveStatus({
      targetUserId,
      isActive: is_active,
      currentUser: req.user
    });

    res.status(200).json({
      success: true,
      message: `User account has been ${is_active ? 'activated' : 'suspended'}.`,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List users (Super Admin sees all, Admin sees own business staff)
 */
export async function listUsers(req, res, next) {
  try {
    const { role, business_id, shop_id } = req.query;
    const users = await authService.listUsers({
      currentUser: req.user,
      role,
      businessId: business_id,
      shopId: shop_id
    });

    res.status(200).json({
      success: true,
      data: { users }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  login,
  getProfile,
  changePassword,
  resetPassword,
  setUserStatus,
  listUsers,
  registerUser
};
