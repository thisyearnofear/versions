// MODULAR: Shared publish gate. Extracted from the duplicated publishTx
// (curation.ts) and tryPublish (agents.ts) implementations. Both services
// now call this single function and handle settlement + post-publish
// fetching themselves.
// CLEAN: publish is logically one transaction. On Neon HTTP we can't
// BEGIN/COMMIT, but the operations are still sequential and we use a
// UNIQUE constraint on published_versions(submission_id) to make
// double-publish a no-op.
// DRY: every module that needs to publish a submission goes through here.

import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  submissions as submissionsTable,
  ratings as ratingsTable,
  publishedVersions as pvTable,
} from '../lib/schema';
import { aggregateRatings, type RatingRowLike } from './taste-graph';
import type { SettlementService } from './settlement';

export interface PublishResult {
  alreadyPublished: boolean;
  legIds: string[];
  distinctCurators: Array<{ curator_wallet: string }>;
}

/**
 * Publish a submission: aggregate ratings, insert into published_versions,
 * update submission status, insert settlement legs. Returns leg IDs so the
 * caller can decide whether to settle immediately or asynchronously.
 *
 * If the submission is already published, returns `{ alreadyPublished: true }`
 * with empty leg IDs.
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
  if (sub.status === 'published') return { alreadyPublished: true, legIds: [], distinctCurators: [] };

  const ratings = (await db
    .select()
    .from(ratingsTable)
    .where(eq(ratingsTable.submissionId, submissionId))) as unknown as RatingRowLike[];
  const agg = aggregateRatings(ratings);

  await db
    .insert(pvTable)
    .values({
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
    })
    .onConflictDoNothing({ target: pvTable.submissionId });

  await db
    .update(submissionsTable)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(submissionsTable.id, submissionId));

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

  return { alreadyPublished: false, legIds: legs.map((l) => l.id), distinctCurators };
}
