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
// PERFORMANT (Phase 4): semantic search via CLAP embeddings + pgvector.
//                        When embeddings are available, the brief text
//                        is embedded and queried against the
//                        version_embeddings table for cosine-distance
//                        nearest neighbors. The structured-tag scorer
//                        still runs for `why_fits` citations, but the
//                        semantic similarity is the primary ranking
//                        signal. Falls back to structured-tag-only
//                        when embeddings are absent (mock mode, no
//                        pgvector, no API key).

import { and, eq, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  publishedVersions as pvTable,
  settlementLegs as legsTable,
  placementBriefs as briefsTable,
} from '../lib/schema';
import { cached } from '../lib/cache';
import { createEmbeddingAdapter, type EmbeddingAdapter } from '../adapters/embedding';
import { log } from '../lib/logger';
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

// ── Semantic search pure functions (Phase 4) ───────────

// MODULAR: cosine similarity between two L2-normalized vectors.
// Exported for testing — the pgvector `<=>` operator computes
// cosine distance (1 - similarity) server-side, but we need the
// pure function for the hybrid scorer and for tests that can't
// use pgvector (PGlite doesn't support the extension).
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors are pre-normalized, so dot product = cosine similarity.
  // Clamp to [0, 1] to avoid floating-point drift above 1.
  return Math.max(0, Math.min(1, dot));
}

// MODULAR: hybrid scoring. Semantic similarity is the primary signal
// (0-1, scaled ×10 → 0-10 range); structured-tag score is secondary
// (raw score × 0.3 → typically 0-6 range); popularity + recency are
// small tiebreakers that never override a real signal. The structured
// score's `why_fits` citations are still surfaced to the supervisor
// because semantic similarity alone doesn't produce explainable matches.
//
// SEMANTIC_WEIGHT controls how much the audio embedding dominates vs
// the structured tags. 0.7 means semantic is ~70% of the ranking
// signal, structured is ~30%. Tunable without a redeploy via env
// (EMBEDDING_SEMANTIC_WEIGHT) — but changing it invalidates cached
// brief results on the next feed-update.
const SEMANTIC_WEIGHT = 0.7;
const STRUCTURED_WEIGHT = 0.3;

export function hybridScore(
  semanticSimilarity: number,
  structuredScore: number,
  popularity: number,
  recency: number,
): number {
  return semanticSimilarity * 10 * SEMANTIC_WEIGHT
    + structuredScore * STRUCTURED_WEIGHT
    + popularity
    + recency;
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

export function createFeedService(opts?: { embedding?: EmbeddingAdapter }): FeedService {
  const embedding = opts?.embedding || createEmbeddingAdapter();

  // ── Structured-tag scorer (v1 fallback) ────────────────
  // MODULAR: extracted from the inline loop so both the fallback
  // path and the test suite can call it directly. Pure function
  // over already-fetched candidate rows.
  function scoreStructuredResults(
    candidates: Array<{ version: typeof pvTable.$inferSelect; brief: typeof briefsTable.$inferSelect | null }>,
    args: BriefSearchArgs,
    tokens: string[],
    safeLimit: number,
    safeOffset: number,
  ): BriefSearchResult {
    type Scored = {
      version: typeof pvTable.$inferSelect;
      brief: typeof briefsTable.$inferSelect;
      score: number;
      why_fits: string[];
    };

    const scored: Scored[] = [];
    for (const c of candidates) {
      if (!c.brief) continue;
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
      const popularity = 0.1 * (c.version.ratingCount ?? 0);
      const recency = 0.05 * Math.max(0, 30 - daysSince(c.version.publishedAt));
      scored.push({
        version: c.version,
        brief: c.brief,
        score: breakdown.score + popularity + recency,
        why_fits: explainFit(breakdown),
      });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTs = a.version.publishedAt?.getTime() ?? 0;
      const bTs = b.version.publishedAt?.getTime() ?? 0;
      return bTs - aTs;
    });
    return buildResult(scored, safeLimit, safeOffset);
  }

  // ── Hybrid semantic + structured-tag scorer (Phase 4) ──
  // MODULAR: takes the pgvector query results (already ranked by
  // cosine distance) and computes the structured-tag score for each
  // row so we get `why_fits` citations. The hybrid score combines
  // semantic similarity (primary) with structured-tag overlap
  // (secondary) + popularity/recency tiebreakers.
  function scoreSemanticResults(
    rows: Array<Record<string, unknown>>,
    args: BriefSearchArgs,
    tokens: string[],
    safeLimit: number,
    safeOffset: number,
  ): BriefSearchResult {
    type Scored = {
      version: typeof pvTable.$inferSelect;
      brief: typeof briefsTable.$inferSelect;
      score: number;
      why_fits: string[];
    };

    const scored: Scored[] = [];
    for (const row of rows) {
      // MODULAR: the pgvector query returns snake_case columns (raw
      // SQL, not Drizzle's camelCase mapping). Normalize into the
      // shape the buildResult helper expects.
      const version = {
        submissionId: row.submission_id as string,
        title: row.title as string,
        artistName: row.artist_name as string,
        versionType: row.version_type as string,
        audioPath: row.audio_path as string,
        coverSvg: row.cover_svg as string | null,
        avgSoloIntensity: row.avg_solo_intensity as number | null,
        avgVocalQuality: row.avg_vocal_quality as number | null,
        energyConsensus: row.energy_consensus as string | null,
        tempoConsensus: row.tempo_consensus as string | null,
        ratingCount: row.rating_count as number,
        aggregatedMoodTags: row.aggregated_mood_tags as string[] | null,
        publishedAt: row.published_at as Date,
      } as typeof pvTable.$inferSelect;

      // MODULAR: brief may be null if the version has no
      // placement_briefs row. Semantic search still returns it
      // (the embedding exists independently), but we need a
      // non-null brief for the structured-tag scorer + the
      // BriefSearchRow.brief field. Use empty defaults.
      const brief = {
        id: '',
        submissionId: row.submission_id as string,
        agentName: 'market',
        sceneTags: (row.scene_tags as string[]) || [],
        instruments: (row.instruments as string[]) || [],
        emotionalArcs: (row.emotional_arcs as string[]) || [],
        syncComparables: (row.sync_comparables as Array<{ name: string; why: string }>) || [],
        audienceSummary: (row.audience_summary as string) || '',
        createdAt: new Date(),
      } as typeof briefsTable.$inferSelect;

      const similarity = row.similarity as number;

      // Apply hard filters (same as structured path).
      if (args.sceneTags && args.sceneTags.length > 0) {
        const ok = args.sceneTags.some((f) => brief.sceneTags.some((s) => s.toLowerCase().includes(f)));
        if (!ok) continue;
      }
      if (args.instruments && args.instruments.length > 0) {
        const ok = args.instruments.some((f) => brief.instruments.some((s) => s.toLowerCase() === f));
        if (!ok) continue;
      }
      if (args.energy && version.energyConsensus !== args.energy) continue;
      if (args.tempo && version.tempoConsensus !== args.tempo) continue;

      // Structured-tag score for why_fits citations.
      const breakdown = scoreAgainstBrief(
        {
          sceneTags: brief.sceneTags,
          instruments: brief.instruments,
          emotionalArcs: brief.emotionalArcs,
          audienceSummary: brief.audienceSummary,
        },
        tokens,
      );

      const popularity = 0.1 * (version.ratingCount ?? 0);
      const recency = 0.05 * Math.max(0, 30 - daysSince(version.publishedAt));
      const score = hybridScore(similarity, breakdown.score, popularity, recency);

      scored.push({
        version,
        brief,
        score,
        why_fits: explainFit(breakdown),
      });
    }

    // MODULAR: already sorted by cosine distance from pgvector, but
    // the hybrid score reorders. Re-sort by hybrid score DESC, then
    // by publishDate DESC for stable tiebreaking.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTs = a.version.publishedAt?.getTime() ?? 0;
      const bTs = b.version.publishedAt?.getTime() ?? 0;
      return bTs - aTs;
    });

    return buildResult(scored, safeLimit, safeOffset);
  }

  // ── Shared result builder ──────────────────────────────
  function buildResult(
    scored: Array<{ version: typeof pvTable.$inferSelect; brief: typeof briefsTable.$inferSelect; score: number; why_fits: string[] }>,
    safeLimit: number,
    safeOffset: number,
  ): BriefSearchResult {
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
  }

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

        // ── Phase 4: try semantic search via CLAP embeddings + pgvector ──
        // MODULAR: embed the brief text and query pgvector for cosine-
        // distance nearest neighbors. If embeddings aren't available
        // (mock mode, no pgvector extension, no version_embeddings rows,
        // or any DB error), fall back to the structured-tag scorer.
        if (!embedding.mock) {
          try {
            const briefEmb = await embedding.embedText(args.brief);
            const embStr = `[${briefEmb.embedding.map((v) => v.toFixed(6)).join(',')}]`;
            // MODULAR: pgvector cosine-distance query. Joins
            // version_embeddings → published_versions → placement_briefs
            // in one round-trip. The `<=>` operator is cosine distance;
            // `1 - distance` is cosine similarity. Filter similarity > 0
            // so zero-overlap rows don't pollute the candidate set.
            const semanticCandidates = await db.execute(sql`
              SELECT
                pv.submission_id, pv.title, pv.artist_name, pv.version_type,
                pv.audio_path, pv.cover_svg, pv.avg_solo_intensity,
                pv.avg_vocal_quality, pv.energy_consensus, pv.tempo_consensus,
                pv.rating_count, pv.aggregated_mood_tags, pv.published_at,
                pb.scene_tags, pb.instruments, pb.emotional_arcs,
                pb.sync_comparables, pb.audience_summary,
                1 - (ve.embedding <=> ${embStr}::vector) AS similarity
              FROM published_versions pv
              JOIN version_embeddings ve ON ve.submission_id = pv.submission_id
              LEFT JOIN placement_briefs pb ON pb.submission_id = pv.submission_id
              WHERE 1 - (ve.embedding <=> ${embStr}::vector) > 0
              ORDER BY ve.embedding <=> ${embStr}::vector
              LIMIT 500
            `);

            if (semanticCandidates.rows && semanticCandidates.rows.length > 0) {
              return scoreSemanticResults(semanticCandidates.rows, args, tokens, safeLimit, safeOffset);
            }
          } catch (err) {
            // MODULAR: fail-open — log and fall through to the
            // structured-tag scorer. This catches: pgvector not
            // installed, version_embeddings table missing, embedding
            // API error, or any other DB-level failure.
            log.warn('semantic search failed, falling back to structured tags', {
              error: (err as Error).message,
              mock: embedding.mock,
            });
          }
        }

        // ── Fallback: structured-tag-only scorer (v1) ──────────────
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

        return scoreStructuredResults(candidates, args, tokens, safeLimit, safeOffset);
      }, ['feed-update']);
    },
  };
}
