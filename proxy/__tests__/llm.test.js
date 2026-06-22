// MODULAR: LLM adapter tests. node:test, mock-first verification.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createLlmAdapter } = require('../adapters/llm');

test('mock mode: returns deterministic reviews without API key', async () => {
  const llm = createLlmAdapter({});
  assert.equal(llm.mock, true);

  const result = await llm.complete({
    system: 'test',
    user: 'test',
    agentName: 'production',
    genre: 'rock',
    versionType: 'live'
  });

  assert.equal(result.mock, true);
  assert.ok(result.parsed);
  assert.ok(result.parsed.solo_intensity >= 1 && result.parsed.solo_intensity <= 10);
  assert.ok(result.parsed.vocal_quality >= 1 && result.parsed.vocal_quality <= 10);
  assert.ok(['lower', 'same', 'higher'].includes(result.parsed.energy_vs_studio));
  assert.ok(['dragging', 'locked', 'rushing'].includes(result.parsed.tempo_feel));
  assert.ok(Array.isArray(result.parsed.mood_tags));
  assert.ok(typeof result.parsed.notes === 'string');
});

test('mock mode: production agent returns valid taste-graph', async () => {
  const llm = createLlmAdapter({});
  const result = await llm.complete({
    agentName: 'production',
    genre: 'jazz',
    versionType: 'acoustic'
  });

  assert.ok(result.parsed.notes.includes('jazz') || result.parsed.notes.includes('acoustic') || result.parsed.notes.length > 10);
});

test('mock mode: market agent returns placement brief', async () => {
  const llm = createLlmAdapter({});
  const result = await llm.complete({
    agentName: 'market',
    genre: 'rock',
    versionType: 'live'
  });

  assert.ok(result.parsed.placement_brief);
  assert.ok(Array.isArray(result.parsed.placement_brief.venues));
  assert.ok(result.parsed.placement_brief.venues.length > 0);
  assert.ok(result.parsed.placement_brief.venues[0].name);
  assert.ok(result.parsed.placement_brief.venues[0].reason);
  assert.ok(Array.isArray(result.parsed.placement_brief.youtube_channels));
  assert.ok(Array.isArray(result.parsed.placement_brief.influencers));
  assert.ok(Array.isArray(result.parsed.placement_brief.draft_emails));
  assert.ok(result.parsed.placement_brief.draft_emails.length > 0);
  assert.ok(result.parsed.placement_brief.draft_emails[0].subject);
  assert.ok(result.parsed.placement_brief.draft_emails[0].body);
  assert.ok(typeof result.parsed.placement_brief.audience_summary === 'string');
});

test('mock mode: different genres produce different venue lists', async () => {
  const llm = createLlmAdapter({});
  const rock = await llm.complete({ agentName: 'market', genre: 'rock', versionType: 'live' });
  const jazz = await llm.complete({ agentName: 'market', genre: 'jazz', versionType: 'live' });

  const rockVenues = rock.parsed.placement_brief.venues.map(v => v.name);
  const jazzVenues = jazz.parsed.placement_brief.venues.map(v => v.name);
  assert.ok(!rockVenues.every((v, i) => v === jazzVenues[i]), 'rock and jazz should have different venues');
});

test('mock mode: deterministic — same input gives same output', async () => {
  const llm = createLlmAdapter({});
  const a = await llm.complete({ agentName: 'production', genre: 'electronic', versionType: 'remix' });
  const b = await llm.complete({ agentName: 'production', genre: 'electronic', versionType: 'remix' });

  assert.equal(a.parsed.solo_intensity, b.parsed.solo_intensity);
  assert.equal(a.parsed.vocal_quality, b.parsed.vocal_quality);
  assert.equal(a.parsed.energy_vs_studio, b.parsed.energy_vs_studio);
  assert.equal(a.parsed.tempo_feel, b.parsed.tempo_feel);
});

test('mock mode: falls back to production agent for unknown agent name', async () => {
  const llm = createLlmAdapter({});
  const result = await llm.complete({
    agentName: 'unknown_agent',
    genre: 'rock',
    versionType: 'live'
  });

  assert.ok(result.parsed);
  assert.ok(result.parsed.solo_intensity >= 1);
  assert.ok(!result.parsed.placement_brief);
});

test('constructor: apiKey enables real mode', () => {
  const llm = createLlmAdapter({
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o'
  });

  assert.equal(llm.mock, false);
  assert.equal(llm.model, 'gpt-4o');
  assert.equal(llm.apiUrl, 'https://api.openai.com/v1');
});
