// MODULAR: pure royalty-waterfall math for authorized version programs.
// No DB, no services — the allocation is a deterministic pure function so
// the money math is unit-testable in isolation and identical wherever it's
// called (settlement legs, pilot reporting, receipts). Amounts are
// integer micro-USDC (USDC has 6 decimals); allocation is
// largest-remainder so the legs always sum EXACTLY to the gross.

import type { RoyaltySplit } from './types';

export const TOTAL_BPS = 10000;

/**
 * Validate a royalty-split leg set. Throws on any rule that would make a
 * settlement ambiguous or lose money:
 *  - at least one leg
 *  - non-empty wallet addresses, unique per leg (one transfer per wallet)
 *  - a single leg takes the whole 100%; multiple legs each hold a strict
 *    (0, 100%) share
 *  - shares sum to exactly 10000 bps (no rounding slack, no lost fees)
 */
export function assertValidSplits(splits: RoyaltySplit[]): void {
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new Error('waterfall: at least one split leg is required');
  }
  const seen = new Set<string>();
  let total = 0;
  for (const leg of splits) {
    if (!leg.wallet || typeof leg.wallet !== 'string') {
      throw new Error('waterfall: every leg needs a wallet address');
    }
    if (seen.has(leg.wallet)) {
      throw new Error(`waterfall: duplicate wallet ${leg.wallet} — merge the legs`);
    }
    seen.add(leg.wallet);
    const min = splits.length === 1 ? TOTAL_BPS : 1;
    if (!Number.isInteger(leg.share_bps) || leg.share_bps < min || leg.share_bps > TOTAL_BPS) {
      throw new Error(
        `waterfall: leg ${leg.wallet} share must be an integer in ${min}..${TOTAL_BPS} bps (single leg must be 100%), got ${leg.share_bps}`,
      );
    }
    total += leg.share_bps;
  }
  if (total !== TOTAL_BPS) {
    throw new Error(`waterfall: shares sum to ${total} bps, expected exactly ${TOTAL_BPS}`);
  }
}

export interface WaterfallLeg {
  wallet: string;
  label: string;
  amountUsdc: bigint; // micro-USDC
}

/**
 * Split `grossMicroUsdc` across the legs. Each leg gets
 * floor(gross * bps / 10000); the leftover dust (always < number of legs)
 * is handed one unit at a time to the legs with the largest fractional
 * remainders, ties broken by leg order. The result sums exactly to the
 * gross, so settlement can transfer the legs without a residual.
 */
export function computeWaterfall(
  splits: RoyaltySplit[],
  grossMicroUsdc: bigint,
): WaterfallLeg[] {
  assertValidSplits(splits);
  if (grossMicroUsdc < 0n) {
    throw new Error('waterfall: gross must be >= 0');
  }

  interface Fractional {
    leg: RoyaltySplit;
    base: bigint;
    remainder: bigint;
  }
  const frac: Fractional[] = [];
  let allocated = 0n;
  for (const leg of splits) {
    const base = (grossMicroUsdc * BigInt(leg.share_bps)) / BigInt(TOTAL_BPS);
    const remainder = (grossMicroUsdc * BigInt(leg.share_bps)) % BigInt(TOTAL_BPS);
    frac.push({ leg, base, remainder });
    allocated += base;
  }
  let dust = grossMicroUsdc - allocated;
  // Largest remainder first; stable order for ties.
  const order = frac
    .map((f, i) => ({ i, remainder: f.remainder }))
    .sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (dust <= 0n) break;
    frac[i].base += 1n;
    dust -= 1n;
  }
  return frac.map(({ leg, base }) => ({
    wallet: leg.wallet,
    label: leg.label,
    amountUsdc: base,
  }));
}
