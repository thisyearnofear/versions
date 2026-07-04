// MODULAR: pure-helper tests for settlement.ts. No DB needed — these
// exercise the leg-count math in isolation so the formula can't drift
// between the publish.ts guard, the over-count log, and splitFee.

import { describe, it, expect } from 'vitest';
import { expectedLegCountFor } from '../../src/services/settlement';

describe('expectedLegCountFor', () => {
  it('curatorCount + 2', () => {
    expect(expectedLegCountFor(0)).toBe(2);
    expect(expectedLegCountFor(3)).toBe(5);
  });
});
