// MODULAR: pure-helper tests for settlement.ts. No DB needed — these
// exercise the leg-count math in isolation so the formula can't drift
// between the publish.ts guard, the over-count log, and splitFee.

import { describe, it, expect } from 'vitest';
import { expectedLegCountFor } from '../../src/services/settlement';
import { settlementToEconomyEvent, type SettlementEvent } from '../../src/lib/event-bus';

describe('expectedLegCountFor', () => {
  it('curatorCount + 2', () => {
    expect(expectedLegCountFor(0)).toBe(2);
    expect(expectedLegCountFor(3)).toBe(5);
  });
});

describe('settlementToEconomyEvent', () => {
  it('normalizes a license receipt for shared activity surfaces', () => {
    const event: SettlementEvent = {
      type: 'settled',
      source: 'license',
      settlementId: 'license-1',
      timestamp: '2026-08-12T00:00:00.000Z',
      amountUsdc: '0.5',
      txHash: '0xabc',
      mock: true,
      toWallet: '0xartist',
      title: 'Night Drive',
      jobId: '42',
    };
    expect(settlementToEconomyEvent(event)).toMatchObject({
      kind: 'license_settled',
      settlementId: 'license-1',
      amountUsdc: '0.5',
      toWallet: '0xartist',
      title: 'Night Drive',
      mock: true,
    });
  });
});
