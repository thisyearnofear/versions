// MODULAR: Shared publish gate. Extracted from the duplicated publishTx
// (curation.ts) and tryPublish (agents.ts) implementations. Both services
// now call this single function and handle settlement + post-publish
// fetching themselves.
// CLEAN: publish is logically one transaction. On Neon HTTP we can't
// BEGIN/COMMIT, so we use the `transactional()` wrapper with
// compensating rollback. Each step registers a compensation; on
// throw, compensations run in reverse. We also use the UNIQUE
// constraint on published_versions(submission_id) to make
// double-publish a no-op.
// DRY: every module that needs to publish a submission goes through here.

import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  submissions as submissionsTable,
  ratings as ratingsTable,
  publishedVersions as pvTable,
  settlementLegs as legsTable,
} from '../lib/schema';
import { aggregateRatings, type RatingRowLike } from './taste-graph';
import { transactional } from '../lib/transaction';
import { log } from '../lib/logger';
import { expectedLegCountFor, type SettlementService } from './settlement';

export interface PublishResult {
  alreadyPublished: boolean;
  legIds: string[];
  distinctCurators: Array<{ curator_wallet: string }>;
}

/**
 * MODULAR: named error so upstream callers (curation.ts submitRating,
 * agents.ts reviewSubmission) can detect this specific publish-gate
 * failure via `instanceof` and return a structured response. Carries
 * enough context for diagnostics without leaking internals: the
 * submissionId, expected vs actual counts, and the actual leg IDs
 * (so callers can log them or surface them in API responses).
 */
export class PublishLegIncompleteError extends Error {
  /**
   * MODULAR: static code so callers can reference the value without
   * instantiating the class (e.g. `if (err.code === PublishLegIncompleteError.CODE)`).
   * The instance `code` field is kept for backwards-compatible access
   * (`err.code`) and mirrors this constant.
   */
  public static readonly CODE = 'publish_legs_incomplete';
  public readonly code: string = PublishLegIncompleteError.CODE;
  public readonly submissionId: string;
  public readonly expected: number;
  public readonly actual: number;
  public readonly actualLegIds: string[];

  constructor(args: {
    submissionId: string;
    expected: number;
    actual: number;
    actualLegIds: string[];
  }) {
    super(
      `Leg insert incomplete for submission ${args.submissionId}: expected ${args.expected}, got ${args.actual}`,
    );
    this.name = 'PublishLegIncompleteError';
    this.submissionId = args.submissionId;
    this.expected = args.expected;
    this.actual = args.actual;
    this.actualLegIds = args.actualLegIds;
  }
}

/**
 * Publish a submission: aggregate ratings, insert into published_versions,
 * update submission status, insert settlement legs. Returns leg IDs so the
 * caller can decide whether to settle immediately or asynchronously.
 *
 * If the submission is already published, returns `{ alreadyPublished: true }`
 * with empty leg IDs.
 *
 * MODULAR: the four DB writes (pv insert, status update, distinct curators
 * fetch, legs insert) are wrapped in `transactional()`. If any step throws
 * after a write succeeds, the compensations clean up so we never leave a
 * partial publish behind.
 */
export async function publishSubmission(
  submissionId: string,
  settlement: SettlementService,
): Promise<PublishResult> {
  const [sub] = await db
    .select()
    .from(submissionsTable)
    .where(eq(submissionsTable.id, submissionId))
    .limit(1);
  if (!sub) throw new Error('Submission not found');
  if (sub.status === 'published') {
    return { alreadyPublished: true, legIds: [], distinctCurators: [] };
  }

  // DRY: snapshot the pre-publish status so compensation can restore it.
  const previousStatus = sub.status;

  return transactional(async (register) => {
    const ratings = (await db
      .select()
      .from(ratingsTable)
      .where(eq(ratingsTable.submissionId, submissionId))) as unknown as RatingRowLike[];
    const agg = aggregateRatings(ratings);

    const pvValues = {
      submissionId: sub.id,
      artistWallet: sub.artistWallet,
      title: sub.title,
      artistName: sub.artistName,
      versionType: sub.versionType,
      audioPath: sub.audioPath,
      musicbrainzId: sub.musicbrainzId,
      coverSvg: sub.coverSvg,
      avgSoloIntensity: agg.avg_solo_intensity,
      avgVocalQuality: agg.avg_vocal_quality,
      energyConsensus: agg.energy_consensus,
      tempoConsensus: agg.tempo_consensus,
      aggregatedMoodTags: agg.aggregated_mood_tags,
      ratingCount: agg.rating_count,
      publishedAt: new Date(),
    };

    const inserted = await db
      .insert(pvTable)
      .values(pvValues)
      .onConflictDoNothing({ target: pvTable.submissionId })
      .returning({ submissionId: pvTable.submissionId });

    if (!inserted || inserted.length === 0) {
      // The pv row was already created (race with another publisher).
      // Re-classify as already-published and let the caller no-op.
      return { alreadyPublished: true as const, legIds: [] as string[], distinctCurators: [] };
    }

    register('delete_pv', async () => {
      try {
        await db.delete(pvTable).where(eq(pvTable.submissionId, submissionId));
      } catch {
        /* swallow — best-effort */
      }
    });

    await db
      .update(submissionsTable)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(submissionsTable.id, submissionId));

    register('restore_sub_status', async () => {
      try {
        await db
          .update(submissionsTable)
          .set({ status: previousStatus, publishedAt: null })
          .where(eq(submissionsTable.id, submissionId));
      } catch {
        /* swallow — best-effort */
      }
    });

    const distinctCurators = await db
      .select({
        curator_wallet: ratingsTable.curatorWallet,
        first_at: sql<Date>`MIN(${ratingsTable.submittedAt})`,
      })
      .from(ratingsTable)
      .where(eq(ratingsTable.submissionId, submissionId))
      .groupBy(ratingsTable.curatorWallet)
      .orderBy(sql`MIN(${ratingsTable.submittedAt}), MIN(${ratingsTable.id})`);

    const legs = await settlement.insertLegsAtomic({
      submissionId,
      feeQuoteUsdc: sub.feeQuoteUsdc,
      curatorWallets: distinctCurators.map((r) => r.curator_wallet),
      musicbrainzWallet: sub.artistWallet,
    });

    // MODULAR: leg-count guard. We expect exactly curators.length + 2 legs
    // (one per curator, one platform, one musicbrainz). insertLegsAtomic
    // is idempotent via onConflictDoNothing against
    // uq_legs_submission_wallet_role, so if a prior failed publish left
    // orphan legs the returned count still equals expected. But if the
    // count is LESS than expected, the constraint may have silently
    // rejected some rows (e.g. wrong recipient_role casing, mismatched
    // wallet format) — throw PublishLegIncompleteError to let the
    // transactional wrapper fire compensations rather than ship a
    // partial publish with missing payouts. If the count is GREATER
    // than expected, orphan legs with (wallet, role) combos the build
    // doesn't generate are present — the actual expected legs ARE there,
    // so the publish can succeed, but we log a warning so the stale
    // rows are traceable for cleanup.
    const expectedLegCount = expectedLegCountFor(distinctCurators.length);
    if (legs.length < expectedLegCount) {
      throw new PublishLegIncompleteError({
        submissionId,
        expected: expectedLegCount,
        actual: legs.length,
        actualLegIds: legs.map((l) => l.id),
      });
    }
    if (legs.length > expectedLegCount) {
      // MODULAR: set difference against the expected (wallet, role)
      // set. We know the expected curator and musicbrainz keys (from
      // distinctCurators + sub.artistWallet). For the platform leg we
      // can't tell which wallet is the "real" one without
      // platformWallet, so all platform legs are treated as expected
      // (they may include orphans, but those are the platform-wallet
      // orphans — not the role-mismatch orphans this check targets).
      const expectedKeys = new Set<string>([
        ...distinctCurators.map((r) => `${r.curator_wallet}:curator`),
        `${sub.artistWallet}:musicbrainz`,
      ]);
      const extras = legs.filter(
        (l) => l.recipient_role !== 'platform' && !expectedKeys.has(`${l.recipient_wallet}:${l.recipient_role}`),
      );
      log.warn('leg count exceeds expected (orphan records present)', {
        submissionId,
        expected: expectedLegCount,
        actual: legs.length,
        extraLegIds: extras.map((l) => l.id),
        extraLegKeys: extras.map((l) => `${l.recipient_wallet}:${l.recipient_role}`),
        allLegKeys: legs.map((l) => `${l.recipient_wallet}:${l.recipient_role}`),
      });
    }

    register('delete_legs', async () => {
      if (legs.length === 0) return;
      try {
        const legIds = legs.map((l) => l.id);
        await db.delete(legsTable).where(sql`${legsTable.id} = ANY(${legIds})`);
      } catch {
        /* swallow — best-effort */
      }
    });

    return {
      alreadyPublished: false as const,
      legIds: legs.map((l) => l.id),
      distinctCurators,
    };
  }, { label: `publishSubmission:${submissionId}` });
}
