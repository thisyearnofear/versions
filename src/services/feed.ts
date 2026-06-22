// MODULAR: Feed service. Pure read code over published_versions.
// DRY: every consumer of "what's published" goes through here.
// PERFORMANT: prepared statements are replaced with a single Drizzle
//             query — neon-http does its own batching.

import { and, eq, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db';
import { publishedVersions as pvTable, settlementLegs as legsTable } from '../lib/schema';
import type { Energy, Tempo } from '../lib/types';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

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
    // CLEAN: mood is stored as a Postgres jsonb array. Drizzle's
    // arrayContains matches elements without hand-rolling SQL.
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

export function createFeedService(): FeedService {
  return {
    async listPublished({
      limit = DEFAULT_LIMIT,
      offset = 0,
      ...filters
    }: FeedListArgs = {}): Promise<FeedListResult> {
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
