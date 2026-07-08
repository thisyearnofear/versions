// MODULAR: Feed service. Pure read code over published_versions.
// DRY: every consumer of "what's published" goes through here.
// PERFORMANT: prepared statements are replaced with a single Drizzle
//             query — neon-http does its own batching.
// PERFORMANT (Phase 2): listPublished wrapped in TTL+event-bus cache.
//                        Key encodes the filter+limit+offset so each
//                        unique view has its own slot; feed-update
//                        events invalidate every key under "feed:*".
// PERFORMANT (Phase 3): searchByBrief (supervisor inverse-search)
//                        joins placement_briefs on the same scan, so
//                        every cache key under "brief:*" invalidates on
//                        feed-update — a publish doesn't replace
//                        existing rows but the catalog size delta
//                        matters for score normalization, so we wipe
//                        and let the next request rehydrate.

import { and, eq, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  publishedVersions as pvTable,
  settlementLegs as legsTable,
  placementBriefs as briefsTable,
} from '../lib/schema';
import { cached } from '../lib/cache';
import type { Energy, Tempo, BriefSearchRow } from '../lib/types';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
// MODULAR: inverse-search results cap. Career-supervisor briefs against
// the full catalog; 50 results per page is the most a real reviewer
// can scan in a session. Larger requests are silently clamped.
export const BRIEF_MAX_LIMIT = 50;
// CLEAN: 30s is a tight window that absorbs the SSE-driven re-fetch
// burst right after a publish event. Longer TTLs risk staleness.
const FEED_CACHE_TTL_MS = 30_000;

const VALID_ENERGY = new Set<Energy>(['lower', 'same', 'higher']);
const VALID_TEMPO = new Set<Tempo>(['dragging', 'locked', 'rushing']);

export interface FeedFilters {
  mood?: string;
  energy?: Energy;
  tempo?: Tempo;
  minSolo?: number;
  maxSolo?: number;
  artistWallet?: string;
}

export interface FeedListArgs extends FeedFilters {
  limit?: number;
  offset?: number;
}

export interface FeedListResult {
  total: number;
  limit: number;
  offset: number;
  rows: Array<typeof pvTable.$inferSelect>;
}

export interface FeedVersionResult {
  version: typeof pvTable.$inferSelect;
  settlement_legs: Array<typeof legsTable.$inferSelect>;
}

export interface FeedService {
  listPublished: (args?: FeedListArgs) => Promise<FeedListResult>;
  getVersion: (submissionId: string) => Promise<FeedVersionResult | null>;
  // MODULAR: supervisor inverse-search. Takes a free-text brief +
  // structured filters, scores every published_version joined with
  // its placement_brief, returns top-N with structured `why_fits`
  // citations. Cached for 30s under "brief:*" — invalidated on
  // feed-update so a publish invalidates the whole index surface.
  searchByBrief: (args: BriefSearchArgs) => Promise<BriefSearchResult>;
}

function buildWhere(filters: FeedFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.mood && typeof filters.mood === 'string') {
    conds.push(sql`${pvTable.aggregatedMoodTags} @> ${JSON.stringify([filters.mood])}::jsonb`);
  }
  if (filters.energy && VALID_ENERGY.has(filters.energy)) {
    conds.push(eq(pvTable.energyConsensus, filters.energy));
  }
  if (filters.tempo && VALID_TEMPO.has(filters.tempo)) {
    conds.push(eq(pvTable.tempoConsensus, filters.tempo));
  }
  if (Number.isFinite(filters.minSolo)) {
    conds.push(gte(pvTable.avgSoloIntensity, filters.minSolo as number));
  }
  if (Number.isFinite(filters.maxSolo)) {
    conds.push(lte(pvTable.avgSoloIntensity, filters.maxSolo as number));
  }
  if (filters.artistWallet && typeof filters.artistWallet === 'string') {
    conds.push(eq(pvTable.artistWallet, filters.artistWallet));
  }
  return conds.length === 0 ? undefined : and(...conds);
}

function feedCacheKey(args: FeedListArgs): string {
  const parts: string[] = [
    String(args.limit ?? DEFAULT_LIMIT),
    String(args.offset ?? 0),
    args.mood ?? '',
    args.energy ?? '',
    args.tempo ?? '',
    Number.isFinite(args.minSolo) ? String(args.minSolo) : '',
    Number.isFinite(args.maxSolo) ? String(args.maxSolo) : '',
    args.artistWallet ?? '',
  ];
  return `feed:${parts.join('|')}`;
}

// ── Brief → Match inverse-search types (Phase 3) ────────

export interface BriefSearchArgs {
  brief: string;
  sceneTags?: string[];
  instruments?: string[];
  energy?: Energy;
  tempo?: Tempo;
  limit?: number;
  offset?: number;
}

export interface BriefSearchResult {
  total: number;
  limit: number;
  offset: number;
  rows: BriefSearchRow[];
}

// MODULAR: stop-word list for tokenizer. Short on purpose — the brief
// is < 500 chars and a heavy NLP pipeline is overkill for v1. Drop
// obvious function words; preserve obvious signal words.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'with', 'is', 'it',
  'this', 'that', 'as', 'at', 'by', 'on', 'be', 'are', 'was', 'were', 'but',
  'not', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'can', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they',
  'their', 'them', 'its', 'if', 'so', 'no', 'yes', 'just', 'than', 'then',
  'now', 'here', 'there', 'about', 'into', 'from', 'out', 'up', 'down',
  'over', 'under', 'again', 'more', 'some', 'any', 'all', 'each', 'few',
  'most', 'other', 'such', 'only', 'own', 'same', 'very', 'too', 'also',
]);

// MODULAR: brief → token set. Lowercase, strip non-word chars, drop
// single chars + stop words, dedupe, cap at 30 tokens (defensive
// against pathological input). Pure function, no DB.
function tokenize(text: string): string[] {
  if (!text) return [];
  const stripped = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  const words = stripped.split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, 30);
}

interface ScoreBreakdown {
  score: number;
  sceneHits: string[];
  instrumentHits: string[];
  arcHits: string[];
  summaryHit: boolean;
}

// MODULAR: scoring. v1 is structured-tag overlap — no embeddings yet.
// Each token that matches a structured field contributes weight:
//   scene tag (any-overlap)        +3
//   instrument (exact-ish)         +2
//   emotional arc (substring)      +1
//   audience summary substring     +1
// Returns BOTH the score and the cited fields so caller can build the
// `why_fits` line. Pure function over already-fetched rows.
function scoreAgainstBrief(
  brief: {
    sceneTags: string[];
    instruments: string[];
    emotionalArcs: string[];
    audienceSummary: string;
  },
  tokens: string[],
): ScoreBreakdown {
  let score = 0;
  const sceneHits: string[] = [];
  for (const tag of brief.sceneTags || []) {
    const tagLower = tag.toLowerCase();
    if (tokens.some((t) => tagLower.includes(t) || (t.length >= 4 && t.includes(tagLower)))) {
      score += 3;
      sceneHits.push(tag);
    }
  }
  const instrumentHits: string[] = [];
  for (const inst of brief.instruments || []) {
    const instLower = inst.toLowerCase();
    if (tokens.some(
      (t) => t === instLower || t.includes(instLower) || (instLower.length >= 4 && instLower.includes(t)),
    )) {
      score += 2;
      instrumentHits.push(inst);
    }
  }
  const arcHits: string[] = [];
  for (const arc of brief.emotionalArcs || []) {
    const arcLower = arc.toLowerCase();
    if (tokens.some((t) => arcLower.includes(t))) {
      score += 1;
      arcHits.push(arc);
    }
  }
  const summaryHit = tokens.some((t) => (brief.audienceSummary || '').toLowerCase().includes(t));
  if (summaryHit) score += 1;
  return { score, sceneHits, instrumentHits, arcHits, summaryHit };
}

// MODULAR: ranked reasons for the field-citation line on the result
// card. Caps at 3 plain-language citations so the supervisor doesn't
// scroll past a wall of text on every match.
function explainFit(breakdown: ScoreBreakdown): string[] {
  const fits: string[] = [];
  for (const tag of breakdown.sceneHits.slice(0, 1)) fits.push(`scene: ${tag}`);
  for (const inst of breakdown.instrumentHits.slice(0, 1)) fits.push(`instrument: ${inst}`);
  for (const arc of breakdown.arcHits.slice(0, 1)) {
    fits.push(`arc: ${arc.length > 60 ? arc.slice(0, 60) + '\u2026' : arc}`);
  }
  if (breakdown.summaryHit) fits.push('summary match');
  return fits.slice(0, 3);
}

function daysSince(date: Date | null | undefined): number {
  if (!date) return 0;
  const ms = Date.now() - date.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function briefCacheKey(args: BriefSearchArgs): string {
  // MODULAR: brief text is included in the cache key so each distinct
  // brief (truncated to 200 chars for sanity) gets its own slot. The
  // token-set is dense enough to produce different keys for nearly
  // every different supervisor paste. Combined with the 30s TTL +
  // feed-update invalidation, this absorbs burst reads without
  // staleness risk.
  const briefHash = (args.brief ?? '').trim().toLowerCase().slice(0, 200);
  const parts = [
    String(args.limit ?? DEFAULT_LIMIT),
    String(args.offset ?? 0),
    briefHash,
    (args.sceneTags ?? []).join(','),
    (args.instruments ?? []).join(','),
    args.energy ?? '',
    args.tempo ?? '',
  ];
  return `brief:${parts.join('|')}`;
}

export function createFeedService(): FeedService {
  return {
    async listPublished(args: FeedListArgs = {}): Promise<FeedListResult> {
      const key = feedCacheKey(args);
      return cached(key, FEED_CACHE_TTL_MS, async () => {
        const {
          limit = DEFAULT_LIMIT,
          offset = 0,
          ...filters
        } = args;
        const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const where = buildWhere(filters);

        const totalRows = await db
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(pvTable)
          .where(where);
        const total = Number(totalRows[0]?.n ?? 0);

        const rows = await db
          .select()
          .from(pvTable)
          .where(where)
          .orderBy(desc(pvTable.publishedAt), desc(pvTable.submissionId))
          .limit(safeLimit)
          .offset(safeOffset);

        return { total, limit: safeLimit, offset: safeOffset, rows };
      }, ['feed-update']);
    },

    async getVersion(submissionId: string): Promise<FeedVersionResult | null> {
      const [version] = await db
        .select()
        .from(pvTable)
        .where(eq(pvTable.submissionId, submissionId))
        .limit(1);
      if (!version) return null;
      const legs = await db
        .select()
        .from(legsTable)
        .where(eq(legsTable.submissionId, submissionId))
        .orderBy(legsTable.recipientRole, legsTable.id);
      return { version, settlement_legs: legs };
    },

    async searchByBrief(args: BriefSearchArgs): Promise<BriefSearchResult> {
      const safeLimit = Math.min(BRIEF_MAX_LIMIT, Math.max(1, Number(args.limit) || DEFAULT_LIMIT));
      const safeOffset = Math.max(0, Number(args.offset) || 0);
      const key = briefCacheKey(args);
      return cached(key, FEED_CACHE_TTL_MS, async () => {
        const tokens = tokenize(args.brief);
        if (tokens.length === 0) {
          return { total: 0, limit: safeLimit, offset: safeOffset, rows: [] };
        }
        // MODULAR: fetch candidate published_versions joined with their
        // placement_briefs. Cap at 500 because every indexed row is
        // scored in-process — at supervisor MVP scale (≤ a few thousand
        // published) this is cheap, and 50 candidates per brief slot
        // is the worst case the ranking sees.
        const candidates = await db
          .select({ version: pvTable, brief: briefsTable })
          .from(pvTable)
          .leftJoin(briefsTable, eq(briefsTable.submissionId, pvTable.submissionId))
          .orderBy(desc(pvTable.publishedAt))
          .limit(500);

        type Scored = {
          version: typeof pvTable.$inferSelect;
          brief: typeof briefsTable.$inferSelect;
          score: number;
          why_fits: string[];
        };

        const scored: Scored[] = [];
        for (const c of candidates) {
          if (!c.brief) continue; // no brief = no matchable metadata
          const breakdown = scoreAgainstBrief(
            {
              sceneTags: c.brief.sceneTags,
              instruments: c.brief.instruments,
              emotionalArcs: c.brief.emotionalArcs,
              audienceSummary: c.brief.audienceSummary,
            },
            tokens,
          );
          if (breakdown.score <= 0) continue;
          // Apply hard filters. scene_tags/instruments overlap already
          // gates score > 0, but the user-supplied filters require
          // overlap with THE filter tokens (subset semantics).
          if (args.sceneTags && args.sceneTags.length > 0) {
            const ok = args.sceneTags.some((f) => (c.brief!.sceneTags || []).some((s) => s.toLowerCase().includes(f)));
            if (!ok) continue;
          }
          if (args.instruments && args.instruments.length > 0) {
            const ok = args.instruments.some((f) =>
              (c.brief!.instruments || []).some((s) => s.toLowerCase() === f),
            );
            if (!ok) continue;
          }
          if (args.energy && c.version.energyConsensus !== args.energy) continue;
          if (args.tempo && c.version.tempoConsensus !== args.tempo) continue;
          // MODULAR: tie-breaker signal. Two weak nudges: rating_count
          // taps popular judgment; recency decays slowly. Keeps the
          // top of the list useful without polluting the ranking.
          const popularity = 0.1 * (c.version.ratingCount ?? 0);
          const recency = 0.05 * Math.max(0, 30 - daysSince(c.version.publishedAt));
          scored.push({
            version: c.version,
            brief: c.brief,
            score: breakdown.score + popularity + recency,
            why_fits: explainFit(breakdown),
          });
        }
        // MODULAR: primary sort by fit_score DESC, secondary by
        // recency (publishDate DESC). Stable so equal-scored rows
        // surface newest first.
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const aTs = a.version.publishedAt?.getTime() ?? 0;
          const bTs = b.version.publishedAt?.getTime() ?? 0;
          return bTs - aTs;
        });
        const total = scored.length;
        const sliced = scored.slice(safeOffset, safeOffset + safeLimit);
        const rows: BriefSearchRow[] = sliced.map((s) => ({
          submission_id: s.version.submissionId,
          title: s.version.title,
          artist_name: s.version.artistName,
          version_type: s.version.versionType,
          audio_path: s.version.audioPath,
          cover_svg: s.version.coverSvg,
          avg_solo_intensity: s.version.avgSoloIntensity,
          avg_vocal_quality: s.version.avgVocalQuality,
          energy_consensus: s.version.energyConsensus,
          tempo_consensus: s.version.tempoConsensus,
          rating_count: s.version.ratingCount,
          aggregated_mood_tags: s.version.aggregatedMoodTags,
          published_at: s.version.publishedAt?.toISOString?.() ?? null,
          fit_score: Math.round(s.score * 100) / 100,
          why_fits: s.why_fits,
          brief: {
            scene_tags: s.brief.sceneTags,
            instruments: s.brief.instruments,
            emotional_arcs: s.brief.emotionalArcs,
            sync_comparables: s.brief.syncComparables,
            audience_summary: s.brief.audienceSummary,
          },
        }));
        return { total, limit: safeLimit, offset: safeOffset, rows };
      }, ['feed-update']);
    },
  };
}
