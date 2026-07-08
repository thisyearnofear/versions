// MODULAR: IPFS unit tests. Pure logic + factory wiring; no real network IO.

import { describe, it, expect } from 'vitest';
import {
  createPinataClient,
  createIpfsFromEnv,
  type PinataClient,
} from '../../src/lib/ipfs';

describe('ipfs: isConfigured + mode', () => {
  it('isConfigured() returns false when no JWT', () => {
    const client = createPinataClient({});
    expect(client.isConfigured()).toBe(false);
    expect(client.mode()).toBe('mock');
  });

  it('isConfigured() returns true when JWT is set', () => {
    const client = createPinataClient({ jwt: 'test-jwt' });
    expect(client.isConfigured()).toBe(true);
    expect(client.mode()).toBe('pinata');
  });

  it('createIpfsFromEnv honours PINATA_JWT env var', () => {
    const prev = process.env.PINATA_JWT;
    process.env.PINATA_JWT = '';
    expect(createIpfsFromEnv().isConfigured()).toBe(false);
    process.env.PINATA_JWT = 'env-jwt';
    expect(createIpfsFromEnv().isConfigured()).toBe(true);
    if (prev === undefined) delete process.env.PINATA_JWT;
    else process.env.PINATA_JWT = prev;
  });
});

describe('ipfs: mockCid via uploadAudio (unconfigured)', () => {
  // The mockCid function isn't exported, but its behaviour is observable
  // through uploadAudio in mock mode.
  let client: PinataClient;

  const setup = () => {
    client = createPinataClient({});
  };

  it('returns deterministic output for the same input', async () => {
    setup();
    const buf = Buffer.from('hello world');
    const a = await client.uploadAudio(buf, 'a.mp3', 'audio/mpeg');
    const b = await client.uploadAudio(buf, 'a.mp3', 'audio/mpeg');
    expect(a.cid).toBe(b.cid);
  });

  it('mock CIDs start with "bafy"', async () => {
    setup();
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const r = await client.uploadAudio(buf, 'x.mp3', 'audio/mpeg');
    expect(r.cid.startsWith('bafy')).toBe(true);
  });

  it('mock uploads set source="mock"', async () => {
    setup();
    const r = await client.uploadAudio(Buffer.from('x'), 'x.mp3', 'audio/mpeg');
    expect(r.source).toBe('mock');
  });

  it('different buffers produce different mock CIDs', async () => {
    setup();
    const a = await client.uploadAudio(Buffer.from('one'), 'a.mp3', 'audio/mpeg');
    const b = await client.uploadAudio(Buffer.from('two'), 'a.mp3', 'audio/mpeg');
    expect(a.cid).not.toBe(b.cid);
  });
});

describe('ipfs: gatewayUrl', () => {
  it('returns `${gateway}/ipfs/${cid}`', () => {
    const c = createPinataClient({});
    expect(c.gatewayUrl('QmXxx')).toBe('https://gateway.pinata.cloud/ipfs/QmXxx');
  });

  it('appends filename when provided', () => {
    const c = createPinataClient({});
    expect(c.gatewayUrl('QmXxx', 'foo.mp3')).toBe(
      'https://gateway.pinata.cloud/ipfs/QmXxx/foo.mp3',
    );
  });

  it('honours custom gateway', () => {
    const c = createPinataClient({ gateway: 'https://example.com/ipfs/' });
    // trailing slash is stripped
    expect(c.gatewayUrl('QmYyy')).toBe('https://example.com/ipfs/QmYyy');
  });
});

// MODULAR: pins the unpin contract that the submission dedup
// short-circuit relies on (see src/app/api/v1/submissions/route.ts).
// A retried IPFS upload that hits the unique index needs the
// redundant pin released so Pinata's per-pin quota doesn't leak.
describe('ipfs: unpin', () => {
  it('mock unpin is a callable no-op (does not throw)', async () => {
    const c = createPinataClient({});
    await expect(c.unpin('QmYyy')).resolves.toBeUndefined();
  });

  it('mock unpin is idempotent across repeated calls', async () => {
    const c = createPinataClient({});
    await c.unpin('QmYyy');
    await expect(c.unpin('QmYyy')).resolves.toBeUndefined();
  });
});
