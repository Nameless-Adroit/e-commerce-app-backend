export function errorHandler(err, req, res, next) {
  console.error('⚠️ Server Error:', err);

  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    message: err.message || 'Internal server error occurred',
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.details = err.details || null;
  }

  res.status(statusCode).json(response);
}

export default errorHandler;
