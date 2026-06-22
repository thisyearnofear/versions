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

export interface MockPlacementBrief {
  venues: Array<{ name: string; reason: string; contact?: string }>;
  youtube_channels: Array<{ name: string; reason: string; followers?: string }>;
  influencers: Array<{ name: string; reason: string; platform?: string }>;
  draft_emails: Array<{ to: string; subject: string; body: string }>;
  audience_summary: string;
}

function mockPlacementBrief(genre: string, versionType: string): MockPlacementBrief {
  const genreVenues: Record<string, Array<{ name: string; reason: string; contact?: string }>> = {
    rock: [
      { name: 'The Troubadour (Los Angeles)', reason: 'Legendary rock venue, books emerging acts for Monday residency slots', contact: 'booking@troubadour.com' },
      { name: 'Bowery Ballroom (New York)', reason: 'Indie rock staple, known for breaking new artists', contact: 'talent@boweryballroom.com' },
      { name: 'The Fillmore (San Francisco)', reason: 'Historic venue with a dedicated rock audience', contact: 'booking@livenation.com' },
    ],
    jazz: [
      { name: 'Blue Note (New York)', reason: 'Premier jazz club, accepts demo submissions for late-night sets', contact: 'submissions@bluenotejazz.com' },
      { name: 'Ronnie Scotts (London)', reason: 'International jazz landmark with an emerging artist program', contact: 'bookings@ronniescotts.co.uk' },
      { name: 'The Jazz Standard (New York)', reason: 'Intimate setting ideal for alternate takes and experimental sets', contact: 'info@jazzstandard.com' },
    ],
    electronic: [
      { name: 'Berghain Kantine (Berlin)', reason: 'Adjacent to Berghain, books experimental electronic acts', contact: 'booking@berghain.de' },
      { name: 'Output (Brooklyn)', reason: 'Electronic music focused, strong local following', contact: 'talent@output.club' },
      { name: 'Fabric (London)', reason: 'Legendary electronic venue with Room 2 for emerging artists', contact: 'bookings@fabriclondon.com' },
    ],
    default: [
      { name: 'Local open mic nights', reason: 'Start with community venues to build a live following', contact: 'Check local listings' },
      { name: 'House concerts network', reason: 'Intimate settings where alternate takes shine', contact: 'sofarsounds.com/perform' },
      { name: 'College radio stations', reason: 'Independent stations actively seek non-standard versions', contact: 'Submit via station websites' },
    ],
  };

  const genreChannels: Record<string, Array<{ name: string; reason: string; followers?: string }>> = {
    rock: [
      { name: 'KEXP', reason: 'Seattle-based, known for live in-studio performances and deep rock curation', followers: '1.2M subscribers' },
      { name: 'Mahogany', reason: 'Focuses on intimate acoustic and alternate performances', followers: '3.8M subscribers' },
      { name: 'NPR Tiny Desk', reason: 'The gold standard for stripped-back performances — submit via NPR Music', followers: '4.1M subscribers' },
    ],
    jazz: [
      { name: 'Jazz Re:freshed', reason: 'UK-based, champions new jazz and alternate takes', followers: '180K subscribers' },
      { name: 'WBGO Jazz 88.3', reason: 'Newark-based, worlds largest jazz radio, accepts submissions', followers: '50K subscribers' },
      { name: 'The Jazz Hole', reason: 'Curates rare and alternate jazz recordings', followers: '95K subscribers' },
    ],
    electronic: [
      { name: 'Boiler Room', reason: 'Underground electronic sessions, accepts artist submissions', followers: '5.2M subscribers' },
      { name: 'Cercle', reason: 'Cinematic electronic performances in unique locations', followers: '3.1M subscribers' },
      { name: 'Mixmag', reason: 'Electronic music media, features new artists and alternate mixes', followers: '1.8M subscribers' },
    ],
    default: [
      { name: 'COLORS', reason: 'Showcases unique artists in a minimalist format', followers: '4.5M subscribers' },
      { name: 'Like I Could Dive', reason: 'Covers and alternate versions from emerging artists', followers: '120K subscribers' },
      { name: 'Our Music Box', reason: 'Intimate live sessions with emerging artists', followers: '200K subscribers' },
    ],
  };

  const genreInfluencers: Record<string, Array<{ name: string; reason: string; platform?: string }>> = {
    rock: [
      { name: '@anthemusical', reason: 'Rock and indie curation, 150K followers, responsive to DM submissions', platform: 'Instagram' },
      { name: '@guitarworldmag', reason: 'Guitar-focused content, features standout solos and alternate takes', platform: 'Instagram' },
    ],
    jazz: [
      { name: '@jazznightswithdominick', reason: 'Jazz discovery, 80K followers, actively seeks new recordings', platform: 'Instagram' },
      { name: '@thejazzgroove', reason: 'Daily jazz curation including live and alternate versions', platform: 'Instagram' },
    ],
    electronic: [
      { name: '@electronicbuddha', reason: 'Electronic music discovery, 200K followers', platform: 'Instagram' },
      { name: '@ravefamily', reason: 'Electronic community, shares new artists and underground sounds', platform: 'Instagram' },
    ],
    default: [
      { name: '@indiespotlight', reason: 'Independent music discovery, 100K+ followers, open to submissions', platform: 'Instagram' },
      { name: '@newmusicdaily', reason: 'Daily new music features across genres', platform: 'Instagram' },
    ],
  };

  const key = genreVenues[genre] ? genre : 'default';

  return {
    venues: genreVenues[key],
    youtube_channels: genreChannels[key],
    influencers: genreInfluencers[key],
    audience_summary:
      `The ${genre} ${versionType} market is strongest among 25-40 year old listeners who value authenticity and variety. ` +
      `Focus outreach on venues that book emerging artists, YouTube channels that feature intimate performances, ` +
      `and influencers who actively curate new ${genre} content. The alternate take angle is your differentiator — ` +
      `lead with "heres a version you havent heard" rather than generic promotion.`,
    draft_emails: [
      {
        to: genreVenues[key][0].name,
        subject: `Booking inquiry: ${genre} artist with ${versionType} material`,
        body:
          `Hi,\n\nI'm a ${genre} artist with a catalog of alternate takes and ${versionType} versions that go beyond standard studio recordings. I'd love to discuss a potential booking.\n\nMy work has been reviewed on VERSIONS, a curated marketplace for alternate versions, where it received strong ratings for performance and production quality.\n\nI'm available for a showcase set and can provide streaming links and press materials.\n\nBest regards`,
      },
      {
        to: genreChannels[key][0].name,
        subject: `Submission: ${genre} ${versionType} performance for consideration`,
        body:
          `Hi,\n\nI'm reaching out with a ${genre} ${versionType} recording that I think would resonate with your audience.\n\nThe track is an alternate take that captures something the studio version didn't — [describe the unique element]. It's been curated and reviewed on VERSIONS, a marketplace dedicated to this kind of material.\n\nI'd love to submit it for your consideration. Streaming link: [your link]\n\nThank you for your time.`,
      },
    ],
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
