/**
 * Cookie Management Middleware
 * Handles parsing and issuing secure HTTP-only cookies for refresh tokens.
 */

const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Parses raw Cookie header string into req.cookies object
 */
export function cookieParserMiddleware(req, res, next) {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;

  if (cookieHeader) {
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const [key, ...values] = pair.trim().split('=');
      if (key) {
        req.cookies[key] = decodeURIComponent(values.join('='));
      }
    }
  }

  /**
   * Helper to issue the HTTP-only Refresh Token cookie
   * @param {string} token
   * @param {Date} expiresAt
   */
  res.setRefreshCookie = (token, expiresAt) => {
    const isProd = process.env.NODE_ENV === 'production';
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const useSecure = isProd || isHttps;

    const cookieParts = [
      `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'HttpOnly',
      'Path=/api/auth',
      `Max-Age=${7 * 24 * 60 * 60}`,
      `Expires=${expiresAt.toUTCString()}`,
      // Cross-origin with credentials requires SameSite=None and Secure=true; otherwise Lax
      useSecure ? 'SameSite=None' : 'SameSite=Lax'
    ];

    if (useSecure) {
      cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
  };

  /**
   * Helper to clear the Refresh Token cookie on logout
   */
  res.clearRefreshCookie = () => {
    const isProd = process.env.NODE_ENV === 'production';
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const useSecure = isProd || isHttps;

    const cookieParts = [
      `${REFRESH_COOKIE_NAME}=`,
      'HttpOnly',
      'Path=/api/auth',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      useSecure ? 'SameSite=None' : 'SameSite=Lax'
    ];

    if (useSecure) {
      cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
  };

  next();
}

export default cookieParserMiddleware;
