// MODULAR: x402 agent-score challenge constants + fee parsing.

import { describe, it, expect } from 'vitest';
import { parseAmountToMicroUsdc } from '../../src/lib/x402';
import { SCORE_FEE_USDC, SCORE_RESOURCE } from '../../src/lib/x402-score';

describe('x402 agent score', () => {
  it('charges a fixed 0.05 USDC score fee', () => {
    expect(SCORE_FEE_USDC).toBe('0.05');
    expect(parseAmountToMicroUsdc(SCORE_FEE_USDC)).toBe(50_000n);
    expect(SCORE_RESOURCE).toBe('/api/x402/score');
  });
});
