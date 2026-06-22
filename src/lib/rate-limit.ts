// MODULAR: Per-IP token-bucket rate limiter. One bucket per (ip, route).
// DRY: the only rate-limiting code path; the route handlers ask the
//      limiter if a request is allowed.
// CLEAN: a request is either allowed or rejected with a 429 +
//      standard error envelope; the limiter knows nothing about the
//      route's business logic.

import { log } from './logger';

export interface RateLimitedRequest {
  headers: Record<string, string | string[] | undefined>;
  // In the Next.js App Router, route handlers don't expose socket info
  // directly. Callers may pass an explicit ip override (e.g. from a
  // middleware-computed value).
  socket?: { remoteAddress?: string | null } | null;
}

export function ipFor(req: RateLimitedRequest, override?: string | null): string {
  if (override) return override;
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
  const fromHeader = typeof first === 'string' ? first.trim() : '';
  if (fromHeader) return fromHeader;
  return req.socket?.remoteAddress || 'unknown';
}

export interface RateLimiter {
  label: string;
  allow: (req: RateLimitedRequest, override?: string | null) => boolean;
  stats: () => { label: string; windowMs: number; max: number; tracked_ips: number };
}

export function createRateLimiter({
  windowMs,
  max,
  label,
}: {
  windowMs: number;
  max: number;
  label: string;
}): RateLimiter {
  // MODULAR: a Map<ip, count[]> keeps a rolling window of timestamps.
  // On each call we drop timestamps older than `windowMs` and check
  // if the count exceeds `max`. Old keys are GC'd when touched.
  const buckets = new Map<string, number[]>();

  function prune(now: number): void {
    const cutoff = now - windowMs;
    for (const [k, arr] of buckets) {
      while (arr.length && arr[0] < cutoff) arr.shift();
      if (arr.length === 0) buckets.delete(k);
    }
  }

  return {
    label,
    allow(req: RateLimitedRequest, override?: string | null) {
      const now = Date.now();
      prune(now);
      const ip = ipFor(req, override);
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
    },
  };
}
