// MODULAR: LLM adapter tests. Mock-first.

import { describe, it, expect } from 'vitest';
import { createLlmAdapter } from '../../src/adapters/llm';

describe('llm: mock mode', () => {
  it('returns deterministic reviews without API key', async () => {
    const llm = createLlmAdapter({});
    expect(llm.mock).toBe(true);

    const r = await llm.complete({
      system: 's',
      user: 'u',
      agentName: 'production',
      genre: 'rock',
      versionType: 'live',
    });

    expect(r.mock).toBe(true);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.solo_intensity).toBeGreaterThanOrEqual(1);
    expect(r.parsed!.solo_intensity).toBeLessThanOrEqual(10);
    expect(['lower', 'same', 'higher']).toContain(r.parsed!.energy_vs_studio);
    expect(['dragging', 'locked', 'rushing']).toContain(r.parsed!.tempo_feel);
    expect(Array.isArray(r.parsed!.mood_tags)).toBe(true);
  });

  it('market agent returns supervisor-facing placement brief', async () => {
    const llm = createLlmAdapter({});
    const r = await llm.complete({
      agentName: 'market',
      genre: 'rock',
      versionType: 'live',
    });
    expect(r.parsed!.placement_brief).toBeDefined();
    // MODULAR: the market brief now carries the supervisor inverse-search
    // shape (scene_tags, instruments, emotional_arcs, sync_comparables,
    // audience_summary) instead of the prior venues/draft_emails marketing
    // shape. Each shape field is non-empty for a normal market call.
    expect(r.parsed!.placement_brief!.scene_tags.length).toBeGreaterThan(0);
    expect(r.parsed!.placement_brief!.instruments.length).toBeGreaterThan(0);
    expect(r.parsed!.placement_brief!.emotional_arcs.length).toBeGreaterThan(0);
    expect(r.parsed!.placement_brief!.sync_comparables.length).toBeGreaterThan(0);
    expect(typeof r.parsed!.placement_brief!.audience_summary).toBe('string');
  });

  it('different genres produce different instrumentation flags', async () => {
    const llm = createLlmAdapter({});
    const rock = await llm.complete({ agentName: 'market', genre: 'rock', versionType: 'live' });
    const jazz = await llm.complete({ agentName: 'market', genre: 'jazz', versionType: 'live' });
    const rockInstruments = rock.parsed!.placement_brief!.instruments.join('|');
    const jazzInstruments = jazz.parsed!.placement_brief!.instruments.join('|');
    expect(rockInstruments).not.toBe(jazzInstruments);
  });

  it('deterministic — same input gives same output', async () => {
    const llm = createLlmAdapter({});
    const a = await llm.complete({ agentName: 'production', genre: 'electronic', versionType: 'remix' });
    const b = await llm.complete({ agentName: 'production', genre: 'electronic', versionType: 'remix' });
    expect(a.parsed!.solo_intensity).toBe(b.parsed!.solo_intensity);
    expect(a.parsed!.tempo_feel).toBe(b.parsed!.tempo_feel);
  });

  it('falls back to production agent for unknown agent name', async () => {
    const llm = createLlmAdapter({});
    const r = await llm.complete({ agentName: 'unknown' as never, genre: 'rock', versionType: 'live' });
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.placement_brief).toBeUndefined();
  });
});

describe('llm: constructor', () => {
  it('apiKey enables real mode', () => {
    const llm = createLlmAdapter({
      apiUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    expect(llm.mock).toBe(false);
    expect(llm.model).toBe('gpt-4o');
    expect(llm.apiUrl).toBe('https://api.openai.com/v1');
  });
});
