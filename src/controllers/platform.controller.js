/**
 * Platform Administration Controller (Platform Owner / Technical Team Gateway)
 */
import * as platformService from '../services/platform.service.js';
import * as authService from '../services/auth.service.js';
import { ROLES } from '../config/constants.js';

/**
 * Public configuration for clients (Platform name, support contacts, payment instructions, active plans)
 */
export async function getPublicConfig(req, res, next) {
  try {
    const config = await platformService.getPublicPlatformConfig();
    res.status(200).json({
      success: true,
      data: config
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Dedicated Platform Owner Login (Super Admin strictly enforced)
 */
export async function platformLogin(req, res, next) {
  try {
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    const result = await authService.authenticateUser({
      ...req.body,
      ipAddress,
      userAgent
    });

    // Enforce strictly Platform Owner role (Super Admin)
    if (result.user.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        code: 'PLATFORM_OWNER_REQUIRED',
        message: 'Access denied: This login gateway is reserved exclusively for the Platform Owner / Technical Team.'
      });
    }

    if (res.setRefreshCookie && result.refreshToken) {
      res.setRefreshCookie(result.refreshToken, result.refreshTokenExpiresAt);
    }

    res.status(200).json({
      success: true,
      message: 'Platform Owner authenticated successfully.',
      data: {
        token: result.accessToken,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        sessionId: result.sessionId,
        user: result.user
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Dedicated Platform Owner Token Refresh (rotates Refresh Token and issues new 15-min Access Token)
 */
export async function platformRefresh(req, res, next) {
  try {
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    const rawRefreshToken = req.cookies?.refreshToken || req.headers['x-refresh-token'] || req.body?.refreshToken;

    if (!rawRefreshToken) {
      return res.status(401).json({
        success: false,
        code: 'REFRESH_TOKEN_MISSING',
        message: 'No refresh token session found. Please sign in.'
      });
    }

    const result = await authService.refreshAccessToken({
      rawRefreshToken,
      ipAddress,
      userAgent
    });

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

export async function getDashboard(req, res, next) {
  try {
    const metrics = await platformService.getPlatformDashboardMetrics();
    res.status(200).json({
      success: true,
      data: metrics
    });
  } catch (err) {
    next(err);
  }
}

export async function listRegistrations(req, res, next) {
  try {
    const filter = req.query.filter || 'pending';
    const requests = await platformService.listRegistrationRequests(filter);
    res.status(200).json({
      success: true,
      data: { requests }
    });
  } catch (err) {
    next(err);
  }
}

export async function approveRegistration(req, res, next) {
  try {
    const result = await platformService.approveRegistrationRequest(req.params.id, {
      adminNotes: req.body.adminNotes,
      currentUser: req.user
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function declineRegistration(req, res, next) {
  try {
    const result = await platformService.declineRegistrationRequest(req.params.id, {
      rejectionReason: req.body.rejectionReason,
      currentUser: req.user
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSettings(req, res, next) {
  try {
    const settings = await platformService.getPlatformSettings();
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const updated = await platformService.updatePlatformSettings(req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Platform settings updated successfully.',
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

export async function listPaymentMethods(req, res, next) {
  try {
    const isSuperAdmin = req.user && req.user.role === 'super_admin';
    const activeOnly = !isSuperAdmin || req.query.all !== 'true';
    const methods = await platformService.listPaymentMethods({ activeOnly });
    res.status(200).json({
      success: true,
      data: methods,
      paymentMethods: methods
    });
  } catch (err) {
    next(err);
  }
}

export async function createPaymentMethod(req, res, next) {
  try {
    const method = await platformService.createPaymentMethod({ ...req.body, currentUser: req.user });
    res.status(201).json({
      success: true,
      message: 'Payment method created.',
      data: method
    });
  } catch (err) {
    next(err);
  }
}

export async function updatePaymentMethod(req, res, next) {
  try {
    const method = await platformService.updatePaymentMethod(parseInt(req.params.id, 10), req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Payment method updated.',
      data: method
    });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogs(req, res, next) {
  try {
    const logs = await platformService.getPlatformAuditLogs(req.query);
    res.status(200).json({
      success: true,
      data: { auditLogs: logs }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  getPublicConfig,
  platformLogin,
  getDashboard,
  listRegistrations,
  approveRegistration,
  declineRegistration,
  getSettings,
  updateSettings,
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  getAuditLogs
};
