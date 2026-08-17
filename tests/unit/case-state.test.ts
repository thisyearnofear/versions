// MODULAR: unit tests for the pure case-state engine extracted from cases.ts.
// These run with no DB — the module is pure row→shape / brief→plan logic.

import { describe, it, expect } from 'vitest';
import { DEFAULT_PLAN, deriveCasePlan, projectStatus } from '../../src/services/case-state';

describe('case-state: deriveCasePlan', () => {
  it('surfaces an instrumental-leaning direction + ranked evidence', () => {
    const plan = deriveCasePlan('tense car chase, no vocals, ~120 bpm', 42, ['Take A', 'Take B']);
    expect(plan.pendingDecision).toMatch(/instrumental/);
    expect(plan.pendingDecision).toMatch(/120 bpm/);
    expect(plan.recommendationText).toContain('Ranked 42 eligible takes');
    expect(plan.recommendationText).toContain('Take A');
  });

  it('never fabricates qualitative claims when nothing ranked yet', () => {
    const plan = deriveCasePlan('a gentle piano piece', 0, []);
    expect(plan.recommendationText).toContain('Interpreted the brief');
    expect(plan.recommendationText).not.toMatch(/Ranked \d+ eligible/);
  });
});

describe('case-state: projectStatus', () => {
  it('derives settlement state from the authoritative license ONLY', () => {
    expect(projectStatus('open', null)).toBe('open'); // no license → stored status
    expect(projectStatus('rights_review', 'pending_payment')).toBe('rights_review'); // request prepared, not cleared
    expect(projectStatus('open', 'settling')).toBe('settlement_pending');
    expect(projectStatus('open', 'paid')).toBe('settled');
  });
});

describe('case-state: DEFAULT_PLAN', () => {
  it('holds one open human gate and keeps rights/settlement honest', () => {
    expect(DEFAULT_PLAN).toHaveLength(6);
    expect(DEFAULT_PLAN.filter((s) => s.current)).toHaveLength(1);
    expect(DEFAULT_PLAN.find((s) => s.key === 'decision')?.done).toBe(false);
    expect(DEFAULT_PLAN.find((s) => s.key === 'settle')?.done).toBe(false);
  });
});