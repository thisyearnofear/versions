// MODULAR: Feed service. Pure read code over published_versions.
// DRY: every consumer of "what's published" goes through here.
// PERFORMANT: prepared statements are replaced with a single Drizzle
//             query — neon-http does its own batching.
// PERFORMANT (Phase 2): listPublished wrapped in TTL+event-bus cache.
//                        Key encodes the filter+limit+offset so each
//                        unique view has its own slot; feed-update
//                        events invalidate every key under "feed:*".

import { and, eq, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db';
import { publishedVersions as pvTable, settlementLegs as legsTable } from '../lib/schema';
import { cached } from '../lib/cache';
import type { Energy, Tempo } from '../lib/types';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
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
  };
}
