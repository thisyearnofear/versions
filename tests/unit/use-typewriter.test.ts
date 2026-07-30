// MODULAR: pacing-math tests for the typewriter hook. The repo has no
// DOM test environment (no jsdom / testing-library), so the React hook
// itself is verified at runtime in the browser; the unit contract here
// locks the pure reveal-rate math the hook is built on.

import { describe, it, expect } from 'vitest';
import { charsPerTick, TICK_MS } from '@/lib/use-typewriter';

describe('useTypewriter pacing math', () => {
  it('default 55 cps ≈ 2 chars per 30ms tick', () => {
    expect(charsPerTick(55)).toBe(2);
  });

  it('never reveals less than 1 char per tick, even at tiny cps', () => {
    expect(charsPerTick(1)).toBe(1);
    expect(charsPerTick(0)).toBe(1);
  });

  it('scales with cps', () => {
    expect(charsPerTick(100)).toBe(3);
    expect(charsPerTick(200)).toBe(6);
  });

  it('a ~250-char rationale lands in the 3-5s drama window at default cps', () => {
    const step = charsPerTick(55);
    const ticks = Math.ceil(250 / step);
    const totalMs = ticks * TICK_MS;
    expect(totalMs).toBeGreaterThanOrEqual(3000);
    expect(totalMs).toBeLessThanOrEqual(5000);
  });

  it('the 2000-char notes cap finishes in bounded time (< 35s)', () => {
    const step = charsPerTick(55);
    expect(Math.ceil(2000 / step) * TICK_MS).toBeLessThan(35_000);
  });
});
