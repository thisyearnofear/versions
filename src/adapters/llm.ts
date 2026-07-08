// MODULAR: LLM adapter. Single interface for all LLM calls.
// DRY: every agent review goes through this adapter. No other module
//      talks to an LLM endpoint.
// PERFORMANT: mock-first — when LLM_API_KEY is missing, returns
//             deterministic reviews so the demo runs without an
//             external service.
// CLEAN: returns typed responses; never throws on connectivity — falls
//        back to mock and flags the response with `mock: true`.

import { createHash } from 'crypto';
import { requestJson } from '../lib/http';
import type { AgentName } from '../lib/types';

const DEFAULT_TIMEOUT = 30000;

// MODULAR: mock review templates keyed by genre. Each agent gets a
// different persona.
const ALL_MOODS = [
  'bluesy',
  'raw',
  'euphoric',
  'melancholic',
  'aggressive',
  'dreamy',
  'groovy',
  'intimate',
  'cinematic',
  'nostalgic',
];

function pickMoods(seed: Buffer, _genre: string): string[] {
  const count = 2 + (seed[4] % 3);
  const moods: string[] = [];
  for (let i = 0; i < count; i++) {
    moods.push(ALL_MOODS[seed[5 + i] % ALL_MOODS.length]);
  }
  return [...new Set(moods)];
}

function mockProductionNotes(genre: string, versionType: string, solo: number, vocal: number): string {
  const notes: string[] = [];
  if (solo >= 7) notes.push(`Strong solo work — the ${versionType} version showcases technical skill that exceeds typical studio takes.`);
  else if (solo <= 4) notes.push(`The solo is restrained, which works for the ${genre} genre but leaves room for more dynamic range.`);
  else notes.push(`Solid solo execution. The ${versionType} feel adds character that a clean studio take would lose.`);

  if (vocal >= 7) notes.push(`Vocal production is polished — clear presence in the mix with good compression.`);
  else notes.push(`Vocal sits slightly behind the mix. A touch more presence in the 2-4kHz range would help it cut through.`);

  return notes.join(' ');
}

function mockPerformanceNotes(genre: string, versionType: string, vocal: number): string {
  const notes: string[] = [];
  if (versionType === 'live') notes.push(`The live energy translates well — you can feel the room and the crowd response in the performance.`);
  else if (versionType === 'acoustic') notes.push(`The stripped-back arrangement lets the emotional core of the song come through clearly.`);
  else if (versionType === 'demo') notes.push(`Demo quality has an honest, unpolished charm that resonates with the ${genre} audience.`);
  else notes.push(`The ${versionType} version brings a distinct character compared to standard releases.`);

  if (vocal >= 7) notes.push(`Vocal delivery is confident and emotionally committed.`);
  else notes.push(`The vocal delivery feels slightly tentative — more takes might capture a more assured performance.`);

  return notes.join(' ');
}

function mockMarketNotes(genre: string, versionType: string): string {
  return `This ${versionType} version fits the current ${genre} market well. ` +
    `Independent ${genre} artists are seeing strong engagement with alternate takes and behind-the-scenes content. ` +
    `The track has placement potential across live venues, curated playlists, and sync licensing.`;
}

// MODULAR: mirror of PlacementBrief in lib/types.ts. Snake_case on purpose
// so the LLM emits / mocks emit a shape that doesn't need remapping at the
// agent_service boundary. The fields drive VIDEO / FILM supervisor
// inverse-search: scene_tags + instruments + emotional_arcs + sync_comparables
// form the searchable profile a brief embeds against.
export interface MockPlacementBrief {
  scene_tags: string[];
  instruments: string[];
  emotional_arcs: string[];
  sync_comparables: Array<{ name: string; why: string }>;
  audience_summary: string;
}

function mockPlacementBrief(genre: string, versionType: string): MockPlacementBrief {
  // Per-genre instrumentation flags. The instruments emit between 3-6
  // entries per genre; the test asserts that two genres produce two
  // different arrays. Rocks are guitar-led hooked long-arc; jazz is
  // piano acoustic; electronic is synth/percussion-led; default is hybrid.
  const genreInstrumentation: Record<string, string[]> = {
    rock: ['guitar_led', 'hybrid', 'hook_heavy', 'long_arc'],
    jazz: ['piano_led', 'acoustic', 'long_arc', 'no_vocals'],
    electronic: ['synth_led', 'percussion_led', 'long_arc'],
    default: ['hybrid', 'acoustic', 'hook_heavy'],
  };

  // Per-genre scene_tags (short noun phrases; supervisor-friendly).
  const genreScenes: Record<string, string[]> = {
    rock: ['arena close-up', 'garage scrub', 'roadside tension'],
    jazz: ['smoke-room monologue', 'rain-slick rooftop', 'midnight phone call'],
    electronic: ['neon chase', 'warehouse set piece', 'time-lapse rooftop'],
    default: ['morning commute', 'quiet reveal', 'arrested development'],
  };

  // Per-genre sync_comparables. Each entry is a reference track whose
  // tonal/pacing qualities a brief would be drawn to.
  const genreComparables: Record<string, Array<{ name: string; why: string }>> = {
    rock: [
      { name: 'Bruce Springsteen — Nebraska', why: `intimate demo-grade ${versionType} feeling that motivates scene cuts` },
      { name: 'Big Thief — UFOF demos', why: `stripped ${versionType} takes that sit under quiet scenes` },
    ],
    jazz: [
      { name: 'Bill Evans — Sunday at the Village Vanguard', why: `live ${versionType} intimacy for observational cuts` },
      { name: 'Robert Glasner — Conversation', why: `sparse ${versionType} layering for broken-tempo beats` },
    ],
    electronic: [
      { name: 'Caribou — Swim tour set', why: `modular electronic ${versionType} warmth for uneasy moods` },
    ],
    default: [
      { name: 'Bon Iver — 22, A Million', why: `genre-bending ${versionType} textures for ambiguous scenes` },
      { name: 'Radiohead — TKOL looseness', why: `low-fidelity ${versionType} patience for held moments` },
    ],
  };

  // Per-genre emotional_arc. Free-text pacing/range description.
  const genreArcs: Record<string, string[]> = {
    rock: ['restrained intro escalating to a cathartic release pre-chorus'],
    jazz: ['conversational opening breaking to unresolved tension late'],
    electronic: ['patient build lifting into melodic centerpiece at 1:30'],
    default: ['intimate low-energy verse resolving into denser hook at the bridge'],
  };

  const key = genreInstrumentation[genre] ? genre : 'default';

  return {
    scene_tags: [...genreScenes[key], key === 'jazz' ? 'late-night cab ride' : 'low-stakes outcome'],
    instruments: genreInstrumentation[key],
    emotional_arcs: genreArcs[key],
    sync_comparables: genreComparables[key],
    audience_summary:
      `Supervisor briefs in ${genre} ${versionType} reward authentic alternate-take framing. ` +
      `Lead with "a version that fits" rather than generic promotion; the inverse-search index is tuned for ` +
      `scene-tag / instrumentation / emotional-arc recall, not popularity.`,
  };
}

export interface MockReview {
  solo_intensity: number;
  vocal_quality: number;
  energy_vs_studio: 'lower' | 'same' | 'higher';
  tempo_feel: 'dragging' | 'locked' | 'rushing';
  mood_tags: string[];
  notes: string;
  placement_brief?: MockPlacementBrief;
}

export const MOCK_TEMPLATES: Record<AgentName, {
  system: string;
  getReview: (genre: string, versionType: string) => MockReview;
}> = {
  production: {
    system: 'You are a music production critic specializing in audio quality, mix, and mastering.',
    getReview(genre: string, versionType: string): MockReview {
      const seed = createHash('md5').update(`${genre}:${versionType}:production`).digest();
      const solo = 3 + (seed[0] % 7);
      const vocal = 4 + (seed[1] % 6);
      const energies = ['lower', 'same', 'higher'] as const;
      const tempos = ['dragging', 'locked', 'rushing'] as const;
      return {
        solo_intensity: solo,
        vocal_quality: vocal,
        energy_vs_studio: energies[seed[2] % 3],
        tempo_feel: tempos[seed[3] % 3],
        mood_tags: pickMoods(seed, genre),
        notes: mockProductionNotes(genre, versionType, solo, vocal),
      };
    },
  },
  performance: {
    system: 'You are a performance critic specializing in vocal delivery, instrumental feel, and emotional impact.',
    getReview(genre: string, versionType: string): MockReview {
      const seed = createHash('md5').update(`${genre}:${versionType}:performance`).digest();
      const solo = 4 + (seed[0] % 6);
      const vocal = 3 + (seed[1] % 7);
      const energies = ['lower', 'same', 'higher'] as const;
      const tempos = ['dragging', 'locked', 'rushing'] as const;
      return {
        solo_intensity: solo,
        vocal_quality: vocal,
        energy_vs_studio: energies[seed[2] % 3],
        tempo_feel: tempos[seed[3] % 3],
        mood_tags: pickMoods(seed, genre),
        notes: mockPerformanceNotes(genre, versionType, vocal),
      };
    },
  },
  market: {
    system: 'You are a music industry analyst specializing in market fit, audience targeting, and placement strategy.',
    getReview(genre: string, versionType: string): MockReview {
      const seed = createHash('md5').update(`${genre}:${versionType}:market`).digest();
      const solo = 3 + (seed[0] % 5);
      const vocal = 4 + (seed[1] % 5);
      const energies = ['lower', 'same', 'higher'] as const;
      const tempos = ['dragging', 'locked', 'rushing'] as const;
      return {
        solo_intensity: solo,
        vocal_quality: vocal,
        energy_vs_studio: energies[seed[2] % 3],
        tempo_feel: tempos[seed[3] % 3],
        mood_tags: pickMoods(seed, genre),
        notes: mockMarketNotes(genre, versionType),
        placement_brief: mockPlacementBrief(genre, versionType),
      };
    },
  },
};

export interface LlmCompleteArgs {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  agentName: AgentName;
  genre?: string;
  versionType?: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmCompleteResult {
  text: string;
  parsed: MockReview | null;
  usage: LlmUsage;
  mock: boolean;
  error?: string;
}

export interface LlmAdapter {
  mock: boolean;
  model: string;
  apiUrl: string | null;
  complete: (args: LlmCompleteArgs) => Promise<LlmCompleteResult>;
}

export function createLlmAdapter({
  apiUrl,
  apiKey,
  model = 'gpt-4o-mini',
  requestTimeoutMs = DEFAULT_TIMEOUT,
}: {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  requestTimeoutMs?: number;
}): LlmAdapter {
  const useMock = !apiKey;

  return {
    mock: useMock,
    model,
    apiUrl: apiUrl || null,

    async complete({ system, user, agentName, genre, versionType }: LlmCompleteArgs): Promise<LlmCompleteResult> {
      if (useMock) {
        const template = MOCK_TEMPLATES[agentName] || MOCK_TEMPLATES.production;
        const review = template.getReview(genre || 'rock', versionType || 'live');
        return {
          text: JSON.stringify(review),
          parsed: review,
          usage: { promptTokens: 0, completionTokens: 0 },
          mock: true,
        };
      }

      const url = `${apiUrl}/chat/completions`;
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      };

      try {
        const res = await requestJson<{
          choices?: Array<{ message?: { content?: string } }>;
          usage?: LlmUsage;
        }>(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            timeoutMs: requestTimeoutMs,
          },
          'LLM complete',
        );

        const text = res.choices && res.choices[0] && res.choices[0].message
          ? res.choices[0].message.content
          : '';

        let parsed: MockReview | null = null;
        try {
          parsed = JSON.parse(text || '') as MockReview;
        } catch {
          parsed = null;
        }

        return {
          text: text || '',
          parsed,
          usage: res.usage || { promptTokens: 0, completionTokens: 0 },
          mock: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[llm] API call failed, falling back to mock: ${msg}`);
        const template = MOCK_TEMPLATES[agentName] || MOCK_TEMPLATES.production;
        const review = template.getReview(genre || 'rock', versionType || 'live');
        return {
          text: JSON.stringify(review),
          parsed: review,
          usage: { promptTokens: 0, completionTokens: 0 },
          mock: true,
          error: msg,
        };
      }
    },
  };
}
