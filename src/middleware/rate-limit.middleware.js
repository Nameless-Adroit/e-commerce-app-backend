/**
 * Rate Limiting Middleware
 * Protects authentication, token refresh, and resource endpoints against brute-force and DoS.
 */

class MemoryRateLimiter {
  constructor(windowMs, maxRequests, message) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.message = message || 'Too many requests. Please slow down.';
    this.hits = new Map();

    // Clean up expired buckets periodically (every 5 minutes)
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.hits.entries()) {
      if (now - bucket.resetTime > this.windowMs) {
        this.hits.delete(key);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
      const key = `${ip}_${req.baseUrl || req.path}`;
      const now = Date.now();

      let bucket = this.hits.get(key);
      if (!bucket || now >= bucket.resetTime) {
        bucket = {
          count: 1,
          resetTime: now + this.windowMs
        };
        this.hits.set(key, bucket);
      } else {
        bucket.count += 1;
      }

      const remaining = Math.max(0, this.maxRequests - bucket.count);
      const retryAfterSeconds = Math.ceil((bucket.resetTime - now) / 1000);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetTime / 1000));

      if (bucket.count > this.maxRequests) {
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          success: false,
          message: this.message,
          retry_after_seconds: retryAfterSeconds
        });
      }

      next();
    };
  }
}

// Strict limiter for authentication & credential endpoints (15 req / 15 min)
export const authRateLimiter = new MemoryRateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  parseInt(process.env.RATE_LIMIT_MAX, 10) || 20,
  'Too many authentication attempts. Please try again in a few minutes.'
).middleware();

// Moderate limiter for general API endpoints (300 req / 15 min)
export const generalRateLimiter = new MemoryRateLimiter(
  15 * 60 * 1000,
  300,
  'Too many requests to this service. Please wait a moment.'
).middleware();

export default {
  authRateLimiter,
  generalRateLimiter
};
