// MODULAR: Grove object-storage unit tests. Pure logic + factory wiring; no real network IO.

import { describe, it, expect } from 'vitest';
import {
  createGroveClient,
  createIpfsFromEnv,
  type ObjectStorageClient,
} from '../../src/lib/ipfs';

describe('grove: isConfigured + mode', () => {
  it('isConfigured() returns false in mock mode', () => {
    const client = createGroveClient({ mock: true });
    expect(client.isConfigured()).toBe(false);
    expect(client.mode()).toBe('mock');
  });

  it('isConfigured() returns true for live Grove (no JWT)', () => {
    const client = createGroveClient({ mock: false, chainId: 232 });
    expect(client.isConfigured()).toBe(true);
    expect(client.mode()).toBe('grove');
  });

  it('isConfigured() returns false when disabled', () => {
    const client = createGroveClient({ disabled: true });
    expect(client.isConfigured()).toBe(false);
  });

  it('createIpfsFromEnv uses mock under VITEST', () => {
    expect(createIpfsFromEnv().mode()).toBe('mock');
  });
});

describe('grove: mock uploadAudio', () => {
  let client: ObjectStorageClient;

  const setup = () => {
    client = createGroveClient({ mock: true });
  };

  it('returns deterministic storage keys for the same input', async () => {
    setup();
    const buf = Buffer.from('hello world');
    const a = await client.uploadAudio(buf, 'a.mp3', 'audio/mpeg');
    const b = await client.uploadAudio(buf, 'a.mp3', 'audio/mpeg');
    expect(a.cid).toBe(b.cid);
  });

  it('mock keys are hex sha256', async () => {
    setup();
    const r = await client.uploadAudio(Buffer.from([0x01, 0x02]), 'x.mp3', 'audio/mpeg');
    expect(r.cid).toMatch(/^[a-f0-9]{64}$/);
  });

  it('mock uploads set source="mock" and lens:// uri', async () => {
    setup();
    const r = await client.uploadAudio(Buffer.from('x'), 'x.mp3', 'audio/mpeg');
    expect(r.source).toBe('mock');
    expect(r.uri).toBe(`lens://${r.cid}`);
  });

  it('different buffers produce different keys', async () => {
    setup();
    const a = await client.uploadAudio(Buffer.from('one'), 'a.mp3', 'audio/mpeg');
    const b = await client.uploadAudio(Buffer.from('two'), 'a.mp3', 'audio/mpeg');
    expect(a.cid).not.toBe(b.cid);
  });
});

describe('grove: gatewayUrl', () => {
  it('returns api.grove.storage/<key>', () => {
    const c = createGroveClient({ mock: true });
    expect(c.gatewayUrl('abc123')).toBe('https://api.grove.storage/abc123');
  });

  it('strips lens:// prefix if present', () => {
    const c = createGroveClient({ mock: true });
    expect(c.gatewayUrl('lens://abc123')).toBe('https://api.grove.storage/abc123');
  });
});

describe('grove: unpin', () => {
  it('is a callable no-op (immutable ACL)', async () => {
    const c = createGroveClient({ mock: true });
    await expect(c.unpin('abc')).resolves.toBeUndefined();
    await expect(c.unpin('abc')).resolves.toBeUndefined();
  });
});
