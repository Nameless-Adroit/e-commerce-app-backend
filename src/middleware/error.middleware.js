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
  
  if (isDbError && !isDev) {
    clientMessage = 'A database service error occurred. Please try again shortly.';
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
