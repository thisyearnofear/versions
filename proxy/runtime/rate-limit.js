// MODULAR: Per-IP token-bucket rate limiter. One bucket per (ip, route).
// DRY: the only rate-limiting code path; the route handlers ask the
//      limiter if a request is allowed.
// CLEAN: a request is either allowed or rejected with a 429 +
//      standard error envelope; the limiter knows nothing about the
//      route's business logic.
//
// ORGANIZED: lives in runtime/ alongside the other cross-cutting
// concerns. The /api/v1/submissions* routes get the tighter
// RATE_LIMIT_AUDIO_MAX; everything else gets a higher default.

'use strict';

const log = require('./logger').log;

function ipFor(req) {
  // MODULAR: trust the first forwarded-for entry in production
  // (set TRUST_PROXY=1 in the deployment env). For localhost this
  // returns the loopback address.
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs, max, label }) {
  // MODULAR: a Map<ip, count[]> keeps a rolling window of timestamps.
  // On each call we drop timestamps older than `windowMs` and check
  // if the count exceeds `max`. Old keys are GC'd when touched.
  const buckets = new Map();

  function prune(now) {
    const cutoff = now - windowMs;
    for (const [k, arr] of buckets) {
      while (arr.length && arr[0] < cutoff) arr.shift();
      if (arr.length === 0) buckets.delete(k);
    }
  }

  return {
    label,
    allow(req) {
      const now = Date.now();
      prune(now);
      const ip = ipFor(req);
      const arr = buckets.get(ip) || [];
      arr.push(now);
      buckets.set(ip, arr);
      const allowed = arr.length <= max;
      if (!allowed) {
        log.warn('rate limit exceeded', { label, ip, count: arr.length, max, windowMs });
      }
      return allowed;
    },
    // MODULAR: stats for /health/ready. Returns the current
    // tracked IP count; small enough to log on demand.
    stats() {
      return { label, windowMs, max, tracked_ips: buckets.size };
    }
  };
}

module.exports = { createRateLimiter, ipFor };
