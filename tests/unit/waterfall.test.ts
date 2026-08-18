// MODULAR: waterfall math is the money primitive for authorized programs —
// pure, deterministic, and must never lose or mint a single micro-USDC.

import { describe, it, expect } from 'vitest';
import { assertValidSplits, computeWaterfall, TOTAL_BPS } from '../../src/lib/waterfall';
import type { RoyaltySplit } from '../../src/lib/types';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);

const legs = (entries: Array<[string, number]>): RoyaltySplit[] =>
  entries.map(([wallet, share_bps]) => ({ wallet, label: wallet, share_bps }));

describe('waterfall validation', () => {
  it('accepts a balanced multi-leg split', () => {
    expect(() => assertValidSplits(legs([[A, 6000], [B, 4000]]))).not.toThrow();
  });

  it('accepts a single 100% leg', () => {
    expect(() => assertValidSplits(legs([[A, 10000]]))).not.toThrow();
  });

  it('rejects an empty set', () => {
    expect(() => assertValidSplits([])).toThrow(/at least one/);
  });

  it('rejects shares that do not sum to 10000', () => {
    expect(() => assertValidSplits(legs([[A, 6000], [B, 3000]]))).toThrow(/sum to 9000/);
  });

  it('rejects a multi-leg split where one leg takes everything', () => {
    expect(() => assertValidSplits(legs([[A, 10000], [B, 0]]))).toThrow();
  });

  it('rejects duplicate wallets', () => {
    expect(() => assertValidSplits(legs([[A, 5000], [A, 5000]]))).toThrow(/duplicate/);
  });

  it('rejects non-integer shares', () => {
    expect(() => assertValidSplits(legs([[A, 5000.5], [B, 4999.5]]))).toThrow();
  });
});

describe('waterfall allocation', () => {
  it('splits exactly on clean ratios', () => {
    const out = computeWaterfall(legs([[A, 6000], [B, 4000]]), 10_000_000n);
    expect(out).toEqual([
      { wallet: A, label: A, amountUsdc: 6_000_000n },
      { wallet: B, label: B, amountUsdc: 4_000_000n },
    ]);
  });

  it('distributes leftover dust by largest remainder and preserves the total', () => {
    // 1,000,001 micro across 3 equal-ish legs: 3333/3333/3334 bps.
    const splits = legs([[A, 3333], [B, 3333], [C, 3334]]);
    const gross = 1_000_001n;
    const out = computeWaterfall(splits, gross);
    const total = out.reduce((s, l) => s + l.amountUsdc, 0n);
    expect(total).toBe(gross); // no micro-USDC lost or minted
    // Each leg is within 1 of its exact pro-rata share.
    for (const [leg, res] of splits.map((s, i) => [s, out[i]])) {
      const exact = (gross * BigInt(leg.share_bps)) / BigInt(TOTAL_BPS);
      const diff = res.amountUsdc - exact;
      expect(diff >= -1n && diff <= 1n).toBe(true);
    }
  });

  it('pays the whole gross to a single 100% leg', () => {
    const out = computeWaterfall(legs([[A, 10000]]), 123_456n);
    expect(out).toHaveLength(1);
    expect(out[0].amountUsdc).toBe(123_456n);
  });

  it('handles a zero gross without error', () => {
    const out = computeWaterfall(legs([[A, 6000], [B, 4000]]), 0n);
    expect(out.reduce((s, l) => s + l.amountUsdc, 0n)).toBe(0n);
  });

  it('rejects a negative gross', () => {
    expect(() => computeWaterfall(legs([[A, 10000]]), -1n)).toThrow(/>= 0/);
  });
});
