// MODULAR: Per-IP rate limiter with two backends.
// DRY: the only rate-limiting code path; route handlers ask the
//      limiter if a request is allowed.
// CLEAN: a request is either allowed or rejected with a 429 +
//      standard error envelope; the limiter knows nothing about the
//      route's business logic.
// PERFORMANT: mock-first — when UPSTASH_REDIS_REST_URL is missing,
//             the in-memory limiter keeps the system testable without
//             an external service. Setting UPSTASH_REDIS_REST_URL +
//             UPSTASH_REDIS_REST_TOKEN switches to globally-coherent
//             rate limiting across serverless instances.

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
  allow: (req: RateLimitedRequest, override?: string | null) => Promise<boolean>;
  stats: () => { label: string; windowMs: number; max: number; tracked_ips: number };
}

export interface RateLimiterConfig {
  windowMs: number;
  max: number;
  label: string;
}

// ── In-memory limiter (fallback when Upstash is not configured) ───

// MODULAR: a Map<ip, count[]> keeps a rolling window of timestamps.
// On each call we drop timestamps older than `windowMs` and check
// if the count exceeds `max`. Old keys are GC'd when touched.
function createInMemoryLimiter({ windowMs, max, label }: RateLimiterConfig): RateLimiter {
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
    async allow(req: RateLimitedRequest, override?: string | null) {
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
    stats() {
      return { label, windowMs, max, tracked_ips: buckets.size };
    },
  };
}

// ── Upstash Redis limiter (globally-coherent) ──────────────────────

// MODULAR: Upstash Redis REST API client. Uses a fixed-window counter
// algorithm: the key encodes the time floor so each window gets its
// own counter. INCR is atomic; EXPIRE auto-cleans the key after the
// window passes. The REST API is HTTP-based (no TCP connection pool),
// which fits the serverless deploy model (Neon, Vercel, Lambda).
//
// The fixed-window approach has a minor boundary effect (a burst
// spanning two windows can get up to 2× max), but this is acceptable
// for a rate limiter whose purpose is abuse prevention, not precise
// throughput guaranteeing. The in-memory fallback uses a true rolling
// window, so the two are not identical — but the difference is
// negligible at the configured limits (30/min audio, 60/min brief).

interface UpstashConfig extends RateLimiterConfig {
  restUrl: string;
  restToken: string;
}

function createUpstashLimiter({ windowMs, max, label, restUrl, restToken }: UpstashConfig): RateLimiter {
  const windowSeconds = Math.ceil(windowMs / 1000);
  // MODULAR: base URL normalization — Upstash REST URLs may or may not
  // have a trailing slash. Strip then re-add so the pipeline path is
  // always correct.
  const baseUrl = restUrl.replace(/\/$/, '');

  async function upstashPipeline(commands: string[][]): Promise<unknown[]> {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`upstash pipeline failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return (await res.json()) as unknown[];
  }

  return {
    label,
    async allow(req: RateLimitedRequest, override?: string | null) {
      const ip = ipFor(req, override);
      const now = Date.now();
      const windowFloor = Math.floor(now / windowMs);
      const key = `rl:${label}:${ip}:${windowFloor}`;
      try {
        // MODULAR: pipeline INCR + EXPIRE so both execute atomically
        // in one round-trip. INCR returns the new count; EXPIRE sets
        // the TTL so the key auto-cleans after the window passes.
        // The EXPIRE only needs to fire once per key (when count is 1),
        // but sending it unconditionally is cheaper than a conditional
        // round-trip and idempotent.
        const results = await upstashPipeline([
          ['INCR', key],
          ['EXPIRE', key, String(windowSeconds)],
        ]);
        const count = Number(results[0]);
        const allowed = count <= max;
        if (!allowed) {
          log.warn('rate limit exceeded', { label, ip, count, max, windowMs, backend: 'upstash' });
        }
        return allowed;
      } catch (err) {
        // MODULAR: fail-open on Upstash errors. A rate limiter that
        // blocks all traffic when Redis is down is worse than one that
        // temporarily lets a few extra requests through. Log the error
        // so the operator sees the degraded state.
        log.error('upstash rate limit check failed, failing open', {
          label, ip, error: (err as Error).message,
        });
        return true;
      }
    },
    // MODULAR: Upstash doesn't expose a "count tracked IPs" command
    // cheaply. Return -1 to signal "not available" — the /health/ready
    // endpoint can distinguish this from the in-memory count.
    stats() {
      return { label, windowMs, max, tracked_ips: -1 };
    },
  };
}

// ── Factory (mock-first, same pattern as arc/gateway/llm adapters) ─

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) {
    log.info('rate limiter using upstash redis', { label: config.label });
    return createUpstashLimiter({ ...config, restUrl, restToken });
  }
  return createInMemoryLimiter(config);
}
