// MODULAR: rate limiter tests. The token-bucket is pure (no IO)
// other than a synthetic socket address; one test for the allow
// path, one for the deny path, one for the prune path.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRateLimiter, ipFor } = require('../runtime/rate-limit');

function fakeReq(remoteAddress) {
  const e = new EventEmitter();
  e.socket = { remoteAddress: remoteAddress || '127.0.0.1' };
  e.headers = {};
  return e;
}

test('rate-limit: allows up to max, then 429s', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3, label: 'test' });
  const req = fakeReq('1.2.3.4');
  assert.equal(limiter.allow(req), true,  'req 1');
  assert.equal(limiter.allow(req), true,  'req 2');
  assert.equal(limiter.allow(req), true,  'req 3');
  assert.equal(limiter.allow(req), false, 'req 4 (over)');
  assert.equal(limiter.allow(req), false, 'req 5 (over)');
});

test('rate-limit: separate buckets per IP', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, label: 'test' });
  const a = fakeReq('1.1.1.1');
  const b = fakeReq('2.2.2.2');
  assert.equal(limiter.allow(a), true,  'a 1');
  assert.equal(limiter.allow(a), false, 'a 2 (over)');
  assert.equal(limiter.allow(b), true,  'b 1 (own bucket)');
  assert.equal(limiter.allow(b), false, 'b 2 (over)');
});

test('rate-limit: prunes old entries past the window', async () => {
  const limiter = createRateLimiter({ windowMs: 10, max: 2, label: 'test' });
  const req = fakeReq('3.3.3.3');
  assert.equal(limiter.allow(req), true);
  assert.equal(limiter.allow(req), true);
  assert.equal(limiter.allow(req), false);
  // Wait past the window, the bucket should reset.
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(limiter.allow(req), true,  'after window expiry');
  assert.equal(limiter.allow(req), true,  'after window expiry (2)');
  assert.equal(limiter.allow(req), false, 'over again');
});

test('rate-limit: stats() reports tracked IPs', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5, label: 'test' });
  limiter.allow(fakeReq('4.4.4.4'));
  limiter.allow(fakeReq('5.5.5.5'));
  const s = limiter.stats();
  assert.equal(s.label, 'test');
  assert.equal(s.max, 5);
  assert.equal(s.tracked_ips, 2);
});

test('ipFor: prefers x-forwarded-for when present', () => {
  const e = new EventEmitter();
  e.headers = { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' };
  e.socket = { remoteAddress: '127.0.0.1' };
  assert.equal(ipFor(e), '10.0.0.1');
});
