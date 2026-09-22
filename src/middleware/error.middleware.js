/**
 * Centralized Error Handling Middleware
 * Ensures secrets, database connection strings, and internal stacks are never leaked.
 */
export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';
  const statusCode = err.statusCode || 500;

  // Mask database / connection errors in production
  let clientMessage = err.message || 'An unexpected error occurred. Please try again.';
  const isDbError = err.code && (err.code.startsWith('ER_') || err.code === 'ECONNREFUSED');
  const isTokenError = err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || (typeof err.message === 'string' && /token|jwt|bearer/i.test(err.message));
  
  if (isDbError && !isDev) {
    clientMessage = 'A database service error occurred. Please try again shortly.';
  } else if (isTokenError) {
    clientMessage = 'Your session has expired. Please sign in to continue.';
    // Log technical token error details securely to security logs
    import('../services/security.service.js').then(({ recordSecurityEvent }) => {
      recordSecurityEvent({
        eventType: 'AUTH_TOKEN_ERROR',
        ipAddress: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        details: { name: err.name, originalMessage: err.message, path: req.originalUrl }
      }).catch(() => {});
    }).catch(() => {});
  }

  // Development logging
  if (statusCode >= 500) {
    console.error(`⚠️ [${new Date().toISOString()}] Server Error (${statusCode}):`, err.message);
  }

  const response = {
    success: false,
    message: clientMessage
  };

  if (err.code) {
    response.code = err.code;
  }

  if (isDev) {
    response.stack = err.stack;
    response.details = err.details || null;
  }

  res.status(statusCode).json(response);
}

export default errorHandler;
