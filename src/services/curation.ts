// MODULAR: Curation service. Owns claim/release/rate/publish + the publish
// gate (N ratings -> publish). All DB writes for these tables go through here.
// CLEAN: publish is a single SQL transaction — if settlement.splitFee
//        throws, the publish rolls back. (On Neon HTTP, "transaction" is
//        a logical grouping; we run the writes sequentially and rely on
//        idempotent unique constraints for recovery.)
// ENHANCEMENT FIRST: reuses the signature verifier pattern from submissions.

import { randomUUID } from 'crypto';
import { verifyMessage, isAddress, getAddress } from 'viem';
import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { emit } from '../lib/event-bus';
import {
  submissions as submissionsTable,
  curatorClaims as claimsTable,
  ratings as ratingsTable,
  publishedVersions as pvTable,
} from '../lib/schema';
import { aggregateRatings, type RatingRowLike } from './taste-graph';
import { validateRating } from '../lib/validation';
import { publishSubmission } from './publish';
import type { SettlementService } from './settlement';

export const CLAIM_MESSAGE = 'VERSIONS_LEPTON_CLAIM';
export const RATE_MESSAGE = 'VERSIONS_LEPTON_RATE';
export const CLAIM_TTL_HOURS = 24;
export const PUBLISH_THRESHOLD = 3;

export type VerifyResult = { ok: true } | { ok: false; error: string };

/**
 * EVM (Ethereum-style) signature verification. Replaces Solana bs58 + tweetnacl.
 */
export function verifyWalletSignature({
  message,
  wallet,
  signature,
}: {
  message: string;
  wallet: string;
  signature: string;
}): VerifyResult {
  if (typeof wallet !== 'string' || !isAddress(wallet)) {
    return { ok: false, error: 'wallet must be a 0x-prefixed 20-byte hex address' };
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, error: 'signature must be a 0x-prefixed 65-byte hex string' };
  }
  try {
    const valid = verifyMessage({
      address: getAddress(wallet),
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return { ok: false, error: 'signature does not match wallet' };
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `signature verification failed: ${msg}` };
  }
}

export interface ClaimResult {
  ok: true;
  claim: {
    id: string;
    submission_id: string;
    curator_wallet: string;
    expires_at: Date;
  };
}

export type SubmitRatingResult =
  | {
      ok: true;
      rating_id: string;
      rating_count: number;
      published: null | {
        alreadyPublished: boolean;
        version?: typeof pvTable.$inferSelect;
        settlement_legs?: Array<typeof pvTable.$inferSelect extends never ? never : unknown>;
        settle_results?: unknown[];
      };
    }
  | { ok: false; error: string };

export interface CurationService {
  publishThreshold: number;
  claimMessage: string;
  rateMessage: string;
  claimSubmission: (args: {
    submissionId: string;
    curatorWallet: string;
    signature: string;
  }) => Promise<ClaimResult | { ok: false; error: string }>;
  releaseClaim: (args: { submissionId: string; curatorWallet: string }) => Promise<{ ok: true; released: boolean }>;
  submitRating: (args: {
    submissionId: string;
    curatorWallet: string;
    signature: string;
    rating: unknown;
  }) => Promise<SubmitRatingResult>;
  publish: (submissionId: string) => Promise<
    | { alreadyPublished: true; legIds: [] }
    | { alreadyPublished: false; legIds: string[] }
  >;
  getCuratorProfile: (wallet: string) => Promise<{
    wallet: string;
    ratings_count: number;
    total_earned_usdc: number;
    recent_ratings: Array<typeof ratingsTable.$inferSelect & { title: string | null; artist_name: string | null }>;
  }>;
  getArtistProfile: (wallet: string) => Promise<{
    wallet: string;
    submissions_count: number;
    published_count: number;
    total_received_usdc: number;
    recent_submissions: Array<typeof submissionsTable.$inferSelect>;
    recent_published: Array<typeof pvTable.$inferSelect>;
  }>;
  listArtistVersions: (
    wallet: string,
    opts?: { limit?: number; offset?: number },
  ) => Promise<{
    total: number;
    limit: number;
    offset: number;
    rows: Array<
      typeof submissionsTable.$inferSelect & {
        rating_count: number;
        published?: {
          avg_solo_intensity: number | null;
          avg_vocal_quality: number | null;
          energy_consensus: string | null;
          tempo_consensus: string | null;
          aggregated_mood_tags: string[] | null;
          published_at: Date;
        };
      }
    >;
  }>;
}

// Stronger typing for the rows returned by listArtistVersions.
export type ArtistVersionRow = Awaited<
  ReturnType<CurationService['listArtistVersions']>
>['rows'][number];


export function createCurationService({ settlement }: { settlement: SettlementService }): CurationService {
  return {
    publishThreshold: PUBLISH_THRESHOLD,
    claimMessage: CLAIM_MESSAGE,
    rateMessage: RATE_MESSAGE,

    async claimSubmission({ submissionId, curatorWallet, signature }) {
      const sigCheck = verifyWalletSignature({ message: CLAIM_MESSAGE, wallet: curatorWallet, signature });
      if (!sigCheck.ok) return { ok: false as const, error: sigCheck.error };

      const [sub] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);
      if (!sub) return { ok: false as const, error: 'Submission not found' };
      if (sub.status !== 'awaiting_curation' && sub.status !== 'in_curation') {
        return { ok: false as const, error: `Cannot claim submission in status ${sub.status}` };
      }
      if (sub.artistWallet.toLowerCase() === curatorWallet.toLowerCase()) {
        return { ok: false as const, error: 'Curator cannot be the artist' };
      }

      const now = new Date();
      const [existing] = await db
        .select()
        .from(claimsTable)
        .where(
          and(
            eq(claimsTable.submissionId, submissionId),
            eq(claimsTable.curatorWallet, curatorWallet),
            sql`${claimsTable.releasedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (existing && existing.expiresAt > now) {
        return { ok: false as const, error: 'Active claim already exists for this curator' };
      }

      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + CLAIM_TTL_HOURS * 60 * 60 * 1000);
      await db.insert(claimsTable).values({
        id,
        submissionId,
        curatorWallet,
        expiresAt,
      });

      // MODULAR: notify SSE subscribers that a curator claimed a submission.
      emit('queue-update', {
        type: 'submission_claimed',
        submissionId,
        timestamp: new Date().toISOString(),
      });

      return {
        ok: true as const,
        claim: { id, submission_id: submissionId, curator_wallet: curatorWallet, expires_at: expiresAt },
      };
    },

    async releaseClaim({ submissionId, curatorWallet }) {
      const result = await db
        .update(claimsTable)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(claimsTable.submissionId, submissionId),
            eq(claimsTable.curatorWallet, curatorWallet),
            sql`${claimsTable.releasedAt} IS NULL`,
          ),
        )
        .returning({ id: claimsTable.id });
      return { ok: true as const, released: result.length > 0 };
    },

    async submitRating({ submissionId, curatorWallet, signature, rating }): Promise<SubmitRatingResult> {
      const sigCheck = verifyWalletSignature({ message: RATE_MESSAGE, wallet: curatorWallet, signature });
      if (!sigCheck.ok) return { ok: false, error: sigCheck.error };

      const validation = validateRating(rating);
      if (!validation.ok) return { ok: false, error: validation.errors.join('; ') };
      const validRating = validation.data;

      const [sub] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);
      if (!sub) return { ok: false, error: 'Submission not found' };
      if (sub.status !== 'awaiting_curation' && sub.status !== 'in_curation') {
        return { ok: false, error: `Cannot rate submission in status ${sub.status}` };
      }

      // CLEAN: must have a non-expired, non-released claim.
      const [claim] = await db
        .select()
        .from(claimsTable)
        .where(
          and(
            eq(claimsTable.submissionId, submissionId),
            eq(claimsTable.curatorWallet, curatorWallet),
            sql`${claimsTable.releasedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (!claim) return { ok: false, error: 'No active claim — claim the submission first' };
      if (claim.expiresAt < new Date()) {
        return { ok: false, error: 'Claim has expired' };
      }

      // CLEAN: proactively check for existing rating before inserting.
      // Drizzle wraps PGlite errors as "Failed query: ..." which doesn't
      // contain "unique" or "duplicate" in err.message, so an explicit
      // check is more reliable than parsing the error message.
      const [existingRating] = await db
        .select({ id: ratingsTable.id })
        .from(ratingsTable)
        .where(
          and(
            eq(ratingsTable.submissionId, submissionId),
            eq(ratingsTable.curatorWallet, curatorWallet),
          ),
        )
        .limit(1);
      if (existingRating) {
        return { ok: false, error: 'Curator has already rated this submission' };
      }

      const id = randomUUID();
      await db.insert(ratingsTable).values({
        id,
        submissionId,
        curatorWallet,
        soloIntensity: validRating.solo_intensity,
        vocalQuality: validRating.vocal_quality,
        energyVsStudio: validRating.energy_vs_studio,
        tempoFeel: validRating.tempo_feel,
        moodTags: validRating.mood_tags || [],
        notes: validRating.notes ?? null,
      });

      await db
        .update(submissionsTable)
        .set({ ratingCount: sql`${submissionsTable.ratingCount} + 1` })
        .where(eq(submissionsTable.id, submissionId));

      const [refreshed] = await db
        .select({ ratingCount: submissionsTable.ratingCount })
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);

      let published: SubmitRatingResult extends { published: infer P } ? P : never = null as never;
      if ((refreshed?.ratingCount ?? 0) >= PUBLISH_THRESHOLD) {
        const publishResult = await publishSubmission(submissionId, settlement);
        if (publishResult.alreadyPublished) {
          published = { alreadyPublished: true } as never;
        } else {
          const settleResults = await settlement.settleLegsAsync(publishResult.legIds);
          const { settlementLegs: legsTable } = await import('../lib/schema');
          const finalLegs = await db.select().from(legsTable).where(eq(legsTable.submissionId, submissionId));
          const [version] = await db.select().from(pvTable).where(eq(pvTable.submissionId, submissionId)).limit(1);
          published = {
            alreadyPublished: false,
            version,
            settlement_legs: finalLegs,
            settle_results: settleResults,
          } as never;

          // MODULAR: notify SSE subscribers that the feed has a new entry.
          emit('feed-update', {
            type: 'published',
            submissionId,
            timestamp: new Date().toISOString(),
          });
        }
      }
      // MODULAR: notify SSE subscribers that a rating was submitted.
      // This fires on every rating regardless of publish threshold.
      emit('queue-update', {
        type: 'submission_rated',
        submissionId,
        timestamp: new Date().toISOString(),
      });

      return {
        ok: true,
        rating_id: id,
        rating_count: refreshed?.ratingCount ?? 0,
        published,
      };
    },

    async publish(submissionId: string) {
      const result = await publishSubmission(submissionId, settlement);
      return { alreadyPublished: result.alreadyPublished, legIds: result.legIds };
    },

    async getCuratorProfile(wallet: string) {
      const recentRatings = await db
        .select({
          id: ratingsTable.id,
          submissionId: ratingsTable.submissionId,
          curatorWallet: ratingsTable.curatorWallet,
          soloIntensity: ratingsTable.soloIntensity,
          vocalQuality: ratingsTable.vocalQuality,
          energyVsStudio: ratingsTable.energyVsStudio,
          tempoFeel: ratingsTable.tempoFeel,
          moodTags: ratingsTable.moodTags,
          notes: ratingsTable.notes,
          submittedAt: ratingsTable.submittedAt,
          title: submissionsTable.title,
          artist_name: submissionsTable.artistName,
        })
        .from(ratingsTable)
        .leftJoin(submissionsTable, eq(submissionsTable.id, ratingsTable.submissionId))
        .where(eq(ratingsTable.curatorWallet, wallet))
        .orderBy(desc(ratingsTable.submittedAt))
        .limit(50);
      const earned = await settlement.sumSettledFor(wallet);
      return {
        wallet,
        ratings_count: recentRatings.length,
        total_earned_usdc: earned,
        recent_ratings: recentRatings,
      };
    },

    async getArtistProfile(wallet: string) {
      const subs = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.artistWallet, wallet))
        .orderBy(desc(submissionsTable.submittedAt))
        .limit(50);
      const published = await db
        .select()
        .from(pvTable)
        .where(eq(pvTable.artistWallet, wallet))
        .orderBy(desc(pvTable.publishedAt))
        .limit(50);
      const received = await settlement.sumSettledFor(wallet);
      return {
        wallet,
        submissions_count: subs.length,
        published_count: published.length,
        total_received_usdc: received,
        recent_submissions: subs,
        recent_published: published,
      };
    },

    async listArtistVersions(wallet, { limit = 50, offset = 0 } = {}) {
      const subs = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.artistWallet, wallet))
        .orderBy(desc(submissionsTable.submittedAt))
        .limit(limit)
        .offset(offset);

      const enriched = await Promise.all(
        subs.map(async (s) => {
          const [countRow] = await db
            .select({ c: sql<number>`COUNT(*)::int` })
            .from(ratingsTable)
            .where(eq(ratingsTable.submissionId, s.id));
          const out = {
            ...s,
            rating_count: Number(countRow?.c ?? 0),
            published: undefined as
              | {
                  avg_solo_intensity: number | null;
                  avg_vocal_quality: number | null;
                  energy_consensus: string | null;
                  tempo_consensus: string | null;
                  aggregated_mood_tags: string[] | null;
                  published_at: Date;
                }
              | undefined,
          };
          if (s.status === 'published') {
            const [pv] = await db
              .select()
              .from(pvTable)
              .where(eq(pvTable.submissionId, s.id))
              .limit(1);
            if (pv) {
              out.published = {
                avg_solo_intensity: pv.avgSoloIntensity,
                avg_vocal_quality: pv.avgVocalQuality,
                energy_consensus: pv.energyConsensus,
                tempo_consensus: pv.tempoConsensus,
                aggregated_mood_tags: pv.aggregatedMoodTags,
                published_at: pv.publishedAt,
              };
            }
          }
          return out;
        }),
      );

      const [totalRow] = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(submissionsTable)
        .where(eq(submissionsTable.artistWallet, wallet));

      return { total: Number(totalRow?.c ?? 0), limit, offset, rows: enriched };
    },
  };
}


