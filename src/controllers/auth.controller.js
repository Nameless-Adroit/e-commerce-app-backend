/**
 * Authentication & Session Controller
 * Coordinates HTTP requests, cookie issuance, and session state.
 */
import * as authService from '../services/auth.service.js';
import * as userService from '../services/user.service.js';
import * as sessionService from '../services/session.service.js';

function getClientContext(req) {
  const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;
  const deviceName = req.body.deviceName || req.headers['x-device-name'] || null;
  const deviceId = req.body.deviceId || req.headers['x-device-id'] || null;
  return { ipAddress, userAgent, deviceName, deviceId };
}

/**
 * Unified Login Portal (Phone Number + 6-Digit PIN for All System Roles)
 */
export async function login(req, res, next) {
  try {
    const { ipAddress, userAgent, deviceName, deviceId } = getClientContext(req);

    const result = await authService.authenticateUser({
      ...req.body,
      deviceName,
      deviceId,
      ipAddress,
      userAgent
    });

    // Issue Refresh Token strictly in secure HTTP-only cookie
    if (res.setRefreshCookie && result.refreshToken) {
      res.setRefreshCookie(result.refreshToken, result.refreshTokenExpiresAt);
    }

    // Never return the refresh token in the JSON body
    res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      data: {
        token: result.accessToken,
        sessionId: result.sessionId,
        redirect_url: result.redirect_url,
        user: result.user
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Rotates Refresh Token and issues a fresh 15-minute Access Token
 */
export async function refresh(req, res, next) {
  try {
    const { ipAddress, userAgent } = getClientContext(req);
    // Read refresh token from HTTP-only cookie, fallback to header, or JSON payload
    const rawRefreshToken = req.cookies?.refreshToken || req.headers['x-refresh-token'] || req.body?.refreshToken;

    if (!rawRefreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token session found. Please sign in.'
      });
    }

    const result = await authService.refreshAccessToken({
      rawRefreshToken,
      ipAddress,
      userAgent
    });

    // Issue new rotated refresh token in HTTP-only cookie
    if (res.setRefreshCookie) {
      res.setRefreshCookie(result.newRawRefreshToken, result.expiresAt);
    }

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
      data: {
        token: result.accessToken,
        accessToken: result.accessToken,
        refreshToken: result.newRawRefreshToken,
        sessionId: result.sessionId
      }
    });
  } catch (err) {
    if (res.clearRefreshCookie) {
      res.clearRefreshCookie();
    }
    next(err);
  }
}

/**
 * Logout current authenticated session
 */
export async function logout(req, res, next) {
  try {
    const sessionId = req.user?.session_id || req.body?.sessionId;
    await authService.logoutUser({
      sessionId,
      userId: req.user?.id
    });

    if (res.clearRefreshCookie) {
      res.clearRefreshCookie();
    }

    res.status(200).json({
      success: true,
      message: 'Successfully logged out.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Revoke all active sessions for current user (Logout All Devices)
 */
export async function logoutAll(req, res, next) {
  try {
    await authService.logoutAllSessions({
      userId: req.user.id
    });

    if (res.clearRefreshCookie) {
      res.clearRefreshCookie();
    }

    res.status(200).json({
      success: true,
      message: 'All active sessions have been revoked.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List all active sessions for current user
 */
export async function getSessions(req, res, next) {
  try {
    const sessions = await sessionService.getUserActiveSessions(req.user.id, req.user.session_id);
    res.status(200).json({
      success: true,
      data: { sessions }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Revoke a specific session belonging to current user
 */
export async function revokeUserSession(req, res, next) {
  try {
    const sessionId = req.params.sessionId;
    await sessionService.revokeSession(sessionId, 'user_revoked_session');

    res.status(200).json({
      success: true,
      message: 'Session revoked successfully.'
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
    const profile = await userService.getUserProfile(req.user.id);
    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update current authenticated user profile
 */
export async function updateProfile(req, res, next) {
  try {
    const profile = await userService.updateUserProfile(req.user.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: profile
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Set or change staff PIN
 */
export async function setPin(req, res, next) {
  try {
    const { pin, oldPin } = req.body;
    const result = await userService.setUserPin(req.user.id, pin, oldPin);
    res.status(200).json({
      success: true,
      message: result.message
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
 * Super Admin or Shop Admin updates a user's details
 */
export async function updateUser(req, res, next) {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const updated = await userService.adminUpdateUser({
      targetUserId,
      updateData: req.body,
      currentUser: req.user
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: updated
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
    const targetUserId = parseInt(req.params.id, 10);
    const { is_active } = req.body;

    const result = await userService.adminUpdateUser({
      targetUserId,
      updateData: { is_active },
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
    const { query: dbQuery } = await import('../config/database.config.js');

    let whereClauses = [];
    let params = [];

    if (req.user.role === 'admin') {
      whereClauses.push('u.business_id = ?');
      params.push(req.user.business_id);
    } else if (req.user.role === 'super_admin') {
      if (business_id) {
        whereClauses.push('u.business_id = ?');
        params.push(parseInt(business_id, 10));
      }
    } else {
      whereClauses.push('u.id = ?');
      params.push(req.user.id);
    }

    if (role) {
      whereClauses.push('u.role = ?');
      params.push(role);
    }

    if (shop_id) {
      whereClauses.push('u.shop_id = ?');
      params.push(parseInt(shop_id, 10));
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `
      SELECT u.id, u.username, u.email, u.phone_number, u.profile_image, u.full_name, u.role, 
             u.business_id, u.shop_id, u.is_active, u.temporary_pin, u.created_at,
             b.name as business_name, b.business_code,
             s.name as shop_name, s.shop_code
      FROM users u
      LEFT JOIN businesses b ON u.business_id = b.id
      LEFT JOIN shops s ON u.shop_id = s.id
      ${whereStr}
      ORDER BY u.role ASC, u.id ASC
    `;

    const users = await dbQuery(sql, params);
    const formattedUsers = users.map(u => ({
      ...u,
      is_active: u.is_active === 1 || u.is_active === true || u.is_active === '1'
    }));

    res.status(200).json({
      success: true,
      data: { users: formattedUsers }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Self-service Business & Owner Registration
 */
export async function registerBusiness(req, res, next) {
  try {
    const result = await authService.registerBusinessAndOwner(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export default {
  login,
  refresh,
  logout,
  logoutAll,
  getSessions,
  revokeUserSession,
  getProfile,
  updateProfile,
  setPin,
  registerUser,
  registerBusiness,
  updateUser,
  setUserStatus,
  listUsers
};
