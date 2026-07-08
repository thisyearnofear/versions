// MODULAR: Submissions service.
// CLEAN: all DB writes go through this module; routes are thin.
// DRY: every other module that needs a submission row imports from here.
// CLEAN: signature verification is one place; routes do not import viem.

import { randomUUID } from 'crypto';
import { verifyMessage, isAddress, getAddress } from 'viem';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { emit } from '../lib/event-bus';
import { submissions as submissionsTable, ratings as ratingsTable, settlementLegs as legsTable } from '../lib/schema';
import type { SubmissionStatus, VersionType } from '../lib/types';
import type { ArcAdapter } from '../adapters/arc';

export const SUBMISSION_MESSAGE = 'VERSIONS_LEPTON_SUBMIT';
export const FEE_QUOTE_USDC = '0.50';

export interface SubmissionMetadataInput {
  title: string;
  artistName: string;
  versionType: VersionType;
  genre?: string | null;
  mood?: string | null;
  description?: string | null;
  audiusTrackId?: string | null;
  musicbrainzId?: string | null;
  coverSvg?: string | null;
}

export interface CreateSubmissionArgs {
  audioPath: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  metadata: SubmissionMetadataInput;
  artistWallet: string;
  signature: string;
  audioIpfsCid?: string | null;
  // MODULAR: sha256 of the raw uploaded audio bytes, captured at
  // the route boundary and used with `artistWallet` (lowercased)
  // as the dedup key against uq_audio_sha256_wallet. Nullable so
  // the in-process triage helpers and any future non-upload
  // call sites can omit it.
  audioSha256?: string | null;
}

export interface SubmissionRow {
  id: string;
  artist_wallet: string;
  audius_track_id: string | null;
  musicbrainz_id: string | null;
  title: string;
  artist_name: string;
  version_type: VersionType;
  genre: string | null;
  artist_mood: string | null;
  description: string | null;
  audio_path: string;
  audio_duration_seconds: number | null;
  audio_size_bytes: number;
  content_type: string;
  fee_quote_usdc: string;
  status: SubmissionStatus;
  payment_tx_hash: string | null;
  payment_verified_at: Date | null;
  submitted_at: Date;
  published_at: Date | null;
  audio_sha256: string | null;
}

export type VerifyResult = { ok: true } | { ok: false; error: string };

export function rowToSubmission(row: typeof submissionsTable.$inferSelect): SubmissionRow {
  return {
    id: row.id,
    artist_wallet: row.artistWallet,
    audius_track_id: row.audiusTrackId,
    musicbrainz_id: row.musicbrainzId,
    title: row.title,
    artist_name: row.artistName,
    version_type: row.versionType as VersionType,
    genre: row.genre,
    artist_mood: row.artistMood,
    description: row.description,
    audio_path: row.audioPath,
    audio_duration_seconds: row.audioDurationSeconds,
    audio_size_bytes: row.audioSizeBytes,
    content_type: row.contentType,
    fee_quote_usdc: row.feeQuoteUsdc,
    status: row.status as SubmissionStatus,
    payment_tx_hash: row.paymentTxHash,
    payment_verified_at: row.paymentVerifiedAt,
    submitted_at: row.submittedAt,
    published_at: row.publishedAt,
    audio_sha256: row.audioSha256 ?? null,
  };
}

/**
 * MODULAR: EVM (Ethereum-style) signature verification.
 * Address is 0x-prefixed 20-byte hex, signature is 0x-prefixed 65-byte hex,
 * signed message is the constant SUBMISSION_MESSAGE (passed verbatim — viem
 * adds the EIP-191 prefix internally).
 */
export async function verifyArtistSignature({
  artistWallet,
  signature,
}: {
  artistWallet: string;
  signature: string;
}): Promise<VerifyResult> {
  if (typeof artistWallet !== 'string' || !isAddress(artistWallet)) {
    return { ok: false, error: 'artistWallet must be a 0x-prefixed 20-byte hex address' };
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, error: 'signature must be a 0x-prefixed 65-byte hex string' };
  }
  try {
    const valid = await verifyMessage({
      address: getAddress(artistWallet),
      message: SUBMISSION_MESSAGE,
      signature: signature as `0x${string}`,
    });
    if (!valid) return { ok: false, error: 'signature does not match artistWallet' };
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `signature verification failed: ${msg}` };
  }
}

export interface SubmissionWithExtras extends SubmissionRow {
  ratings: Array<typeof ratingsTable.$inferSelect>;
  settlement_legs: Array<typeof legsTable.$inferSelect>;
}

export type SubmitResult =
  | { ok: true; submission: SubmissionRow; deduped: boolean }
  | { ok: false; error: string };

export type VerifyPaymentResult =
  | { ok: true; submission: SubmissionWithExtras }
  | { ok: false; error: string };

export interface SubmissionsService {
  feeQuoteUsdc: string;
  submissionMessage: string;
  createSubmission: (args: CreateSubmissionArgs) => Promise<SubmitResult>;
  getSubmissionAsync: (id: string) => Promise<SubmissionWithExtras | null>;
  listQueueAsync: (opts?: { limit?: number; offset?: number }) => Promise<SubmissionRow[]>;
  verifyPayment: (id: string, txHash: string) => Promise<VerifyPaymentResult>;
}

export async function fetchSubmissionWithExtras(id: string): Promise<SubmissionWithExtras | null> {
  const [subRow] = await db
    .select()
    .from(submissionsTable)
    .where(eq(submissionsTable.id, id))
    .limit(1);
  if (!subRow) return null;
  const ratings = await db
    .select()
    .from(ratingsTable)
    .where(eq(ratingsTable.submissionId, id));
  const legs = await db
    .select()
    .from(legsTable)
    .where(eq(legsTable.submissionId, id));
  return {
    ...rowToSubmission(subRow),
    ratings,
    settlement_legs: legs,
  };
}

export async function listQueueAsync({
  limit = 20,
  offset = 0,
}: { limit?: number; offset?: number } = {}): Promise<SubmissionRow[]> {
  const rows = await db
    .select()
    .from(submissionsTable)
    .where(inArray(submissionsTable.status, ['awaiting_curation', 'in_curation']))
    .orderBy(submissionsTable.submittedAt)
    .limit(limit)
    .offset(offset);
  return rows.map(rowToSubmission);
}

export function createSubmissionsService({
  arc,
  platformWallet,
}: {
  arc: ArcAdapter;
  platformWallet?: string;
}): SubmissionsService {
  return {
    feeQuoteUsdc: FEE_QUOTE_USDC,
    submissionMessage: SUBMISSION_MESSAGE,

    async createSubmission({
      audioPath,
      contentType,
      sizeBytes,
      durationSeconds,
      metadata,
      artistWallet,
      signature,
      audioSha256,
    }: CreateSubmissionArgs): Promise<SubmitResult> {
      const sigCheck = await verifyArtistSignature({ artistWallet, signature });
      if (!sigCheck.ok) return { ok: false, error: sigCheck.error };

      // MODULAR: lookup-first dedup. The unique index
      // uq_audio_sha256_wallet on (audioSha256, artistWallet) is the
      // contract — this SELECT is the common-path fast path that
      // covers the typical "user hit submit twice" case (IPFS
      // retried, browser double-fired, etc.). The race fallback
      // after the insert handles the double-click where two
      // parallel requests both fall through the lookup.
      const walletKey = artistWallet.toLowerCase();
      if (audioSha256) {
        const [existing] = await db
          .select()
          .from(submissionsTable)
          .where(
            and(
              eq(submissionsTable.audioSha256, audioSha256),
              eq(submissionsTable.artistWallet, walletKey),
            ),
          )
          .limit(1);
        if (existing) {
          return { ok: true, submission: rowToSubmission(existing), deduped: true };
        }
      }

      const id = randomUUID();
      // MODULAR: insert with onConflictDoNothing so a parallel
      // double-click concurrent with the lookup above lands safely
      // on the unique index instead of crashing the request with
      // a Postgres unique-violation error. The .returning() being
      // empty is the signal that someone else won the race — we
      // then re-fetch and return as deduped.
      const insertValues = {
        id,
        artistWallet: walletKey,
        audiusTrackId: metadata.audiusTrackId || null,
        musicbrainzId: metadata.musicbrainzId || null,
        title: metadata.title,
        artistName: metadata.artistName,
        versionType: metadata.versionType,
        genre: metadata.genre || null,
        artistMood: metadata.mood || null,
        description: metadata.description || null,
        audioPath,
        audioDurationSeconds: durationSeconds ?? null,
        audioSizeBytes: sizeBytes,
        contentType,
        feeQuoteUsdc: FEE_QUOTE_USDC,
        coverSvg: metadata.coverSvg || null,
        status: 'pending_payment' as const,
        audioSha256: audioSha256 ?? null,
      };
      const [row] = audioSha256
        ? await db
            .insert(submissionsTable)
            .values(insertValues)
            .onConflictDoNothing({
              target: [submissionsTable.audioSha256, submissionsTable.artistWallet],
            })
            .returning()
        : await db.insert(submissionsTable).values(insertValues).returning();

      if (!row) {
        // Race fallback — the unique index caught a parallel insert.
        if (audioSha256) {
          const [existing] = await db
            .select()
            .from(submissionsTable)
            .where(
              and(
                eq(submissionsTable.audioSha256, audioSha256),
                eq(submissionsTable.artistWallet, walletKey),
              ),
            )
            .limit(1);
          if (existing) {
            return { ok: true, submission: rowToSubmission(existing), deduped: true };
          }
        }
        return { ok: false, error: 'Insert failed' };
      }

      // MODULAR: notify SSE subscribers that a new submission exists.
      emit('submission-created', {
        type: 'created',
        submissionId: id,
        artistWallet: walletKey,
        timestamp: new Date().toISOString(),
      });

      return { ok: true, submission: rowToSubmission(row), deduped: false };
    },

    async getSubmissionAsync(id: string): Promise<SubmissionWithExtras | null> {
      return fetchSubmissionWithExtras(id);
    },

    async listQueueAsync(opts) {
      return listQueueAsync(opts);
    },

    async verifyPayment(id: string, txHash: string): Promise<VerifyPaymentResult> {
      const [row] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, id))
        .limit(1);
      if (!row) return { ok: false, error: 'Submission not found' };
      if (row.status !== 'pending_payment') {
        return { ok: false, error: `Cannot verify payment for status ${row.status}` };
      }

      const tx = await arc.getTransaction(txHash);
      if (!tx) return { ok: false, error: 'Transaction not found' };
      if (tx.status !== 'finalized' && tx.status !== '0x1') {
        return { ok: false, error: `Transaction not finalized (status=${tx.status})` };
      }
      if (!tx.mock) {
        if (tx.to && platformWallet && tx.to.toLowerCase() !== platformWallet.toLowerCase()) {
          return { ok: false, error: 'Payment recipient does not match platform wallet' };
        }
      }

      await db
        .update(submissionsTable)
        .set({
          status: 'awaiting_curation',
          paymentTxHash: txHash,
          paymentVerifiedAt: new Date(),
        })
        .where(eq(submissionsTable.id, id));

      const submission = await fetchSubmissionWithExtras(id);
      if (!submission) return { ok: false, error: 'Submission disappeared after update' };

      // MODULAR: notify SSE subscribers that a new item entered the queue.
      emit('queue-update', {
        type: 'submission_added',
        submissionId: id,
        timestamp: new Date().toISOString(),
      });

      return { ok: true, submission };
    },
  };
}
