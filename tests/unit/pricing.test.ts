// MODULAR: license pricing schedule is pure and exhaustive per usage type.

import { describe, it, expect } from 'vitest';
import { LICENSE_FEES, LICENSE_USAGE_TYPES, licenseFeeUsdc } from '../../src/lib/pricing';

describe('license pricing', () => {
  it('returns a positive decimal fee for every supported usage type', () => {
    for (const usage of LICENSE_USAGE_TYPES) {
      const fee = licenseFeeUsdc(usage);
      expect(typeof fee).toBe('string');
      expect(Number(fee)).toBeGreaterThan(0);
      expect(LICENSE_FEES[usage]).toBe(fee);
    }
  });
});