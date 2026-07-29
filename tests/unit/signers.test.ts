// MODULAR: signer derivation tests. No DB, no network. Pins the
// deterministic derivation contract: same seed + label → same key +
// address, different labels/seeds diverge, and every output is a
// valid checksummed EVM address that viem accepts.

import { describe, it, expect } from 'vitest';
import { isAddress, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deriveAgentKey, deterministicAddress, buildSignerMap } from '../../src/lib/signers';

describe('deriveAgentKey', () => {
  it('is deterministic: same seed + label → same key + address', () => {
    const a = deriveAgentKey('test-seed', 'production');
    const b = deriveAgentKey('test-seed', 'production');
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.address).toBe(b.address);
  });

  it('different labels produce different keys', () => {
    const labels = ['production', 'performance', 'market', 'ar'];
    const keys = labels.map((l) => deriveAgentKey('test-seed', l).privateKey);
    expect(new Set(keys).size).toBe(labels.length);
  });

  it('different seeds produce different keys for the same label', () => {
    expect(deriveAgentKey('seed-a', 'production').privateKey).not.toBe(
      deriveAgentKey('seed-b', 'production').privateKey,
    );
  });

  it('address is a valid checksummed EVM address that matches the key', () => {
    const { privateKey, address } = deriveAgentKey('test-seed', 'ar');
    expect(isAddress(address)).toBe(true);
    expect(address).toBe(getAddress(address)); // checksummed
    expect(privateKeyToAccount(privateKey).address).toBe(address);
  });

  it('throws on missing seed or label', () => {
    expect(() => deriveAgentKey('', 'production')).toThrow(/seed/);
    expect(() => deriveAgentKey('test-seed', '')).toThrow(/label/);
  });
});

describe('deterministicAddress', () => {
  it('returns a stable, valid, checksummed address per label', () => {
    const a = deterministicAddress('production');
    expect(a).toBe(deterministicAddress('production'));
    expect(isAddress(a)).toBe(true);
    expect(a).toBe(getAddress(a));
    expect(a).not.toBe(deterministicAddress('market'));
  });
});

describe('buildSignerMap', () => {
  it('includes the platform key under its derived lowercase address', () => {
    const platformKey = ('0x' + 'db'.repeat(32)) as `0x${string}`;
    const platformAddr = privateKeyToAccount(platformKey).address.toLowerCase();
    const { signers, addresses } = buildSignerMap({ platformWalletPrivateKey: platformKey });
    expect(signers[platformAddr]).toBe(platformKey);
    expect(Object.keys(addresses)).toHaveLength(0);
  });

  it('normalizes a platform key missing its 0x prefix', () => {
    const raw = 'db'.repeat(32);
    const platformAddr = privateKeyToAccount(('0x' + raw) as `0x${string}`).address.toLowerCase();
    const { signers } = buildSignerMap({ platformWalletPrivateKey: raw });
    expect(signers[platformAddr]).toBe('0x' + raw);
  });

  it('derives one signer per label when a seed is set', () => {
    const labels = ['production', 'performance', 'market', 'ar'];
    const { signers, addresses } = buildSignerMap({ agentKeySeed: 'test-seed', labels });
    expect(Object.keys(addresses).sort()).toEqual([...labels].sort());
    for (const label of labels) {
      const addr = addresses[label];
      expect(isAddress(addr)).toBe(true);
      expect(signers[addr.toLowerCase()]).toBe(deriveAgentKey('test-seed', label).privateKey);
    }
  });

  it('returns empty maps when neither key nor seed is configured', () => {
    const { signers, addresses } = buildSignerMap({ labels: ['production'] });
    expect(Object.keys(signers)).toHaveLength(0);
    expect(Object.keys(addresses)).toHaveLength(0);
  });
});
