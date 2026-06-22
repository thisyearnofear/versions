// MODULAR: rate-limit port. Pure functions; no IO.

import { describe, it, expect } from 'vitest';
import { createRateLimiter, ipFor, type RateLimitedRequest } from '../../src/lib/rate-limit';

function fakeReq(remoteAddress: string | null): RateLimitedRequest {
  return {
    socket: { remoteAddress: remoteAddress ?? '127.0.0.1' },
    headers: {},
  };
}

describe('rate-limit: allows up to max, then 429s', () => {
  it('rejects once the bucket is full', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, label: 'test' });
    const req = fakeReq('1.2.3.4');
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(false);
    expect(limiter.allow(req)).toBe(false);
  });
});

describe('rate-limit: separate buckets per IP', () => {
  it('each IP gets its own bucket', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, label: 'test' });
    const a = fakeReq('1.1.1.1');
    const b = fakeReq('2.2.2.2');
    expect(limiter.allow(a)).toBe(true);
    expect(limiter.allow(a)).toBe(false);
    expect(limiter.allow(b)).toBe(true);
    expect(limiter.allow(b)).toBe(false);
  });
});

describe('rate-limit: prunes old entries past the window', () => {
  it('old entries are pruned after windowMs', async () => {
    const limiter = createRateLimiter({ windowMs: 10, max: 2, label: 'test' });
    const req = fakeReq('3.3.3.3');
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(false);
    await new Promise((r) => setTimeout(r, 25));
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(true);
    expect(limiter.allow(req)).toBe(false);
  });
});

describe('rate-limit: stats', () => {
  it('tracks distinct IPs', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5, label: 'test' });
    limiter.allow(fakeReq('4.4.4.4'));
    limiter.allow(fakeReq('5.5.5.5'));
    const s = limiter.stats();
    expect(s.label).toBe('test');
    expect(s.max).toBe(5);
    expect(s.tracked_ips).toBe(2);
  });
});

describe('ipFor', () => {
  it('prefers x-forwarded-for when present', () => {
    const r: RateLimitedRequest = {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(ipFor(r)).toBe('10.0.0.1');
  });

  it('falls back to socket.remoteAddress', () => {
    const r: RateLimitedRequest = {
      headers: {},
      socket: { remoteAddress: '192.168.1.1' },
    };
    expect(ipFor(r)).toBe('192.168.1.1');
  });

  it('returns "unknown" if no IP can be determined', () => {
    const r: RateLimitedRequest = { headers: {}, socket: null };
    expect(ipFor(r)).toBe('unknown');
  });

  it('honours explicit override', () => {
    const r: RateLimitedRequest = { headers: {}, socket: null };
    expect(ipFor(r, '9.9.9.9')).toBe('9.9.9.9');
  });
});
