// MODULAR: pure-function tests for A&R reasoning derivation and the
// reveal-mode helper. No DB, no jsdom — imports the modules directly.

import { describe, it, expect } from 'vitest';
import { buildPlaylistReasoning, firstSentence, type ReasoningInput } from '../../src/services/ar';
import { reasoningRevealMode } from '../../src/lib/playlist-reasoning-ui';

function baseInput(overrides: Partial<ReasoningInput> = {}): ReasoningInput {
  return {
    genre: 'rock',
    topMood: 'energetic',
    moodCounts: [['energetic', 2], ['raw', 1]],
    selected: [
      { title: 'Thunder Run', artistName: 'The Volts', avgSoloIntensity: 8.5, avgVocalQuality: 7.2, versionType: 'live' },
      { title: 'Static Sky', artistName: 'Nova Ray', avgSoloIntensity: 7.1, avgVocalQuality: 8.8, versionType: 'acoustic' },
    ],
    totalCandidates: 14,
    reviewSnippets: [
      { title: 'Thunder Run', note: 'A ferocious solo section anchors this take. The rest meanders.' },
    ],
    ...overrides,
  };
}

describe('buildPlaylistReasoning', () => {
  it('cites pool size, ranking rule, and top-pick scores', () => {
    const text = buildPlaylistReasoning(baseInput());
    expect(text).toContain('Picked 2 of 14 published rock versions');
    expect(text).toContain('ranked by combined solo intensity and vocal quality');
    expect(text).toContain('"Thunder Run" by The Volts');
    expect(text).toContain('solo 8.5 / vocal 7.2');
  });

  it('reports mood consensus with counts when tagged on multiple tracks', () => {
    const text = buildPlaylistReasoning(baseInput());
    expect(text).toContain('"energetic" is the mood consensus, tagged on 2 of 2 tracks.');
  });

  it('includes at most two review excerpts, first sentence only', () => {
    const text = buildPlaylistReasoning(baseInput({
      reviewSnippets: [
        { title: 'Thunder Run', note: 'First sentence one. Second sentence dropped.' },
        { title: 'Static Sky', note: 'Excerpt two here. Also dropped.' },
        { title: 'Third Track', note: 'Never appears. Nope.' },
      ],
    }));
    expect(text).toContain('First sentence one.');
    expect(text).not.toContain('Second sentence dropped');
    expect(text).toContain('Excerpt two here.');
    expect(text).not.toContain('Never appears');
  });

  it('is deterministic for identical input', () => {
    expect(buildPlaylistReasoning(baseInput())).toBe(buildPlaylistReasoning(baseInput()));
  });

  it('handles "picked all" pools and missing scores/mood', () => {
    const text = buildPlaylistReasoning(baseInput({
      totalCandidates: 2,
      topMood: null,
      selected: [
        { title: 'Solo Cup', artistName: 'One Band', avgSoloIntensity: null, avgVocalQuality: null, versionType: 'live' },
        { title: 'B Side', artistName: 'One Band', avgSoloIntensity: null, avgVocalQuality: null, versionType: 'live' },
      ],
      reviewSnippets: [],
    }));
    expect(text).toContain('Picked all 2 published rock versions');
    expect(text).not.toContain('scores solo');
    expect(text).not.toContain('mood');
  });

  it('singular mood phrasing when tag count is 1', () => {
    const text = buildPlaylistReasoning(baseInput({ moodCounts: [['energetic', 1]] }));
    expect(text).toContain('"energetic" sets the mood.');
  });

  it('returns empty string for empty selection', () => {
    expect(buildPlaylistReasoning(baseInput({ selected: [] }))).toBe('');
  });

  it('stays under the max-chars budget even with long excerpts', () => {
    const longNote = 'x'.repeat(300) + '. tail';
    const text = buildPlaylistReasoning(baseInput({
      reviewSnippets: [
        { title: 'A', note: longNote },
        { title: 'B', note: longNote },
      ],
    }));
    expect(text.length).toBeLessThanOrEqual(480);
  });
});

describe('firstSentence', () => {
  it('extracts the first sentence', () => {
    expect(firstSentence('Hello world. Second sentence.')).toBe('Hello world.');
  });

  it('falls back to whole text without terminal punctuation', () => {
    expect(firstSentence('no punctuation here')).toBe('no punctuation here');
  });

  it('truncates long sentences with an ellipsis', () => {
    const out = firstSentence('a'.repeat(200) + '.', 140);
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not split on decimals mid-sentence', () => {
    expect(firstSentence('Scores 8.5 on solo intensity. Next.')).toBe('Scores 8.5 on solo intensity.');
  });
});

describe('reasoningRevealMode', () => {
  it('hidden when collapsed regardless of played state', () => {
    expect(reasoningRevealMode({ expanded: false, played: false })).toBe('hidden');
    expect(reasoningRevealMode({ expanded: false, played: true })).toBe('hidden');
  });

  it('typewriter on first expand', () => {
    expect(reasoningRevealMode({ expanded: true, played: false })).toBe('typewriter');
  });

  it('instant once already played', () => {
    expect(reasoningRevealMode({ expanded: true, played: true })).toBe('instant');
  });
});
