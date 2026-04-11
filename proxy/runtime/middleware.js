const { randomUUID } = require('crypto');
const { sendError } = require('./errors');

function attachRequestContext(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.trim()
    ? incoming.trim()
    : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

function createRateLimitMiddleware({ windowMs, maxRequests, label }) {
  const buckets = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count <= maxRequests) {
      return next();
    }

    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('retry-after', String(retryAfterSeconds));
    return sendError(
      res,
      429,
      `${label || 'rate-limit'} exceeded`,
      `Retry in ${retryAfterSeconds}s`,
      'RATE_LIMITED',
      req.requestId
    );
  };
}

module.exports = {
  attachRequestContext,
  createRateLimitMiddleware
};

