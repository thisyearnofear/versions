import { sql } from 'drizzle-orm';
import { pgTable, text, integer, real, timestamp, index, unique, uniqueIndex, jsonb, boolean, customType, check } from 'drizzle-orm/pg-core';
import type { AgentDetail, AuthorizationStatus, AudioFeatures, ConsentPolicy, ProgramStatus, RoyaltySplit, VersionLineage } from './types';

// MODULAR: pgvector custom column type. Stores a float array that
// Postgres treats as a `vector(N)` column when the pgvector extension
// is installed. The extension must be created before db:push:
//   CREATE EXTENSION IF NOT EXISTS vector;
// See scripts/create-pgvector-extension.sql.
const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 512})`;
  },
  toDriver(value: number[]): string {
    return `[${value.map((v) => v.toFixed(6)).join(',')}]`;
  },
  fromDriver(value: string): number[] {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '');
    return inner.split(',').map(Number);
  },
});

// ── Users ──────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  walletAddress: text('wallet_address').notNull().unique(),
  email: text('email'),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Submissions ────────────────────────────────────────

export const submissions = pgTable('submissions', {
  id: text('id').primaryKey(),
  artistWallet: text('artist_wallet').notNull().references(() => users.walletAddress),
  audiusTrackId: text('audius_track_id'),
  musicbrainzId: text('musicbrainz_id'),
  title: text('title').notNull(),
  artistName: text('artist_name').notNull(),
  versionType: text('version_type').notNull(), // demo|live|acoustic|remix|remaster|studio|other
  genre: text('genre'),
  artistMood: text('artist_mood'),
  description: text('description'),
  audioPath: text('audio_path').notNull(),
  audioDurationSeconds: integer('audio_duration_seconds'),
  audioSizeBytes: integer('audio_size_bytes').notNull(),
  contentType: text('content_type').notNull(),
  // MODULAR: dedup key for retried IPFS uploads. Captured at the
  // route boundary (sha256 of the raw audio bytes) and stored
  // alongside the artist_wallet so a retry from the SAME wallet
  // with the SAME bytes short-circuits to the existing submission.
  // Nullable so legacy seed rows + edge cases (no body parse)
  // still pass the column-NOT-NULL constraint. Postgres treats
  // NULLs as distinct in the unique index below — so legacy rows
  // don't accidentally collide; only pairs with both sha256 AND
  // artist_wallet present are deduped.
  audioSha256: text('audio_sha256'),

  feeQuoteUsdc: text('fee_quote_usdc').notNull(),
  coverSvg: text('cover_svg'),
  // MODULAR: authorized-version program lineage (pilot). When set, this
  // submission is a derivative version produced under an artist-authorized
  // consent program. authorizationStatus is the artist's per-version gate:
  // only 'approved' versions publish as catalog_source 'authorized' (and
  // therefore carry pre-clearance). lineage records derivative provenance
  // (tools + upstream versions) for audit. NULL on all non-program takes.
  programId: text('program_id').references(() => versionPrograms.id),
  authorizationStatus: text('authorization_status').$type<AuthorizationStatus | null>(), // pending_approval|approved|rejected
  authorizedAt: timestamp('authorized_at'),
  lineage: jsonb('lineage').$type<VersionLineage | null>(),
  // Audio features extracted from the source audio for agent scoring.
  // Populated at publish time by the feature extraction pipeline.
  // Agents receive these features alongside metadata to make their
  // "sync fit" ratings defensible (not just metadata guesses).
  audioFeatures: jsonb('audio_features').$type<AudioFeatures | null>(),
  status: text('status').notNull().default('pending_payment'), // pending_payment|awaiting_curation|in_curation|published|rejected
  paymentTxHash: text('payment_tx_hash'),
  paymentVerifiedAt: timestamp('payment_verified_at'),
  ratingCount: integer('rating_count').notNull().default(0),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  publishedAt: timestamp('published_at'),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('idx_submissions_status').on(table.status, table.submittedAt),
  index('idx_submissions_artist').on(table.artistWallet),
  // MODULAR: dedup contract at the DB boundary. The route computes
  // sha256(audioBytes) and the service does lookup-first + insert
  // with .onConflictDoNothing(target=[audioSha256, artistWallet]).
  // The lookup avoids the race because a SELECT inside the same
  // transaction sees committed rows (Read Committed); the
  // ON CONFLICT clause is the belt-and-suspenders for the
  // double-click race in case the lookup SELECT misses (rare but
  // possible across parallel workers in the same cold-start).
  unique('uq_audio_sha256_wallet').on(table.audioSha256, table.artistWallet),
]);

// ── Authorized Version Programs (pilot) ───────────────
// MODULAR: one row per artist-authorized version program — the consent
// record + royalty waterfall for a pilot. A submission links to a program
// via submissions.program_id; when it publishes with authorizationStatus
// 'approved', published_versions.catalog_source becomes 'authorized' (the
// one source where pre-clearance is a recorded fact, not an assumption).
// The concierge pilot mirrors ONE lawyer-drafted agreement per program; the
// jsonb columns are the structured slice of that agreement the platform
// needs to gate, evidence, and settle. Canonical shapes: src/lib/types.ts.
export const versionPrograms = pgTable('version_programs', {
  id: text('id').primaryKey(),
  rightsHolderWallet: text('rights_holder_wallet').notNull(),
  sourceTitle: text('source_title').notNull(),
  sourceArtist: text('source_artist').notNull(),
  musicbrainzId: text('musicbrainz_id'),
  consentPolicy: jsonb('consent_policy').notNull().$type<ConsentPolicy>(),
  splits: jsonb('splits').notNull().$type<RoyaltySplit[]>(),
  status: text('status').notNull().default('active').$type<ProgramStatus>(), // active|revoked|completed
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_version_programs_rights_holder').on(table.rightsHolderWallet),
  check('version_programs_status_check', sql`${table.status} IN ('active', 'revoked', 'completed')`),
  check('version_programs_splits_check', sql`jsonb_array_length(${table.splits}) >= 1`),
]);

// ── Curator Claims ─────────────────────────────────────

export const curatorClaims = pgTable('curator_claims', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => submissions.id),
  curatorWallet: text('curator_wallet').notNull(),
  claimedAt: timestamp('claimed_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  releasedAt: timestamp('released_at'),
}, (table) => [
  unique('uq_claim_submission_curator').on(table.submissionId, table.curatorWallet),
  index('idx_claims_submission').on(table.submissionId),
]);

// ── Ratings ────────────────────────────────────────────

export const ratings = pgTable('ratings', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => submissions.id),
  curatorWallet: text('curator_wallet').notNull(),
  soloIntensity: integer('solo_intensity').notNull(),
  vocalQuality: integer('vocal_quality').notNull(),
  energyVsStudio: text('energy_vs_studio').notNull(), // lower|same|higher
  tempoFeel: text('tempo_feel').notNull(), // dragging|locked|rushing
  moodTags: jsonb('mood_tags').notNull().$type<string[]>(),
  notes: text('notes'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_rating_submission_curator').on(table.submissionId, table.curatorWallet),
  index('idx_ratings_submission').on(table.submissionId),
]);

// ── Agent Reviews ──────────────────────────────────────

export const agentReviews = pgTable('agent_reviews', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => submissions.id),
  agentName: text('agent_name').notNull(), // production|performance|market
  curatorWallet: text('curator_wallet').notNull(),
  soloIntensity: integer('solo_intensity').notNull(),
  vocalQuality: integer('vocal_quality').notNull(),
  energyVsStudio: text('energy_vs_studio').notNull(),
  tempoFeel: text('tempo_feel').notNull(),
  moodTags: jsonb('mood_tags').notNull().$type<string[]>(),
  notes: text('notes'),
  rawResponse: text('raw_response'),
  // MODULAR: per-agent differentiated verdict detail (the expert headline
  // metric + this agent's 1-10 sync-fit), persisted so the /agents surface
  // can render the three agents' distinct lenses long after the stream ends.
  detail: jsonb('detail').$type<AgentDetail | null>(),
  fitScore: integer('fit_score'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_agent_review').on(table.submissionId, table.agentName),
  index('idx_agent_reviews_submission').on(table.submissionId),
]);

// ── Placement Briefs ───────────────────────────────────

export const placementBriefs = pgTable('placement_briefs', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().unique().references(() => submissions.id),
  agentName: text('agent_name').notNull().default('market'),
  // MODULAR: placement_brief repurposed for the supervisor inverse-search
  // index. The market agent emits scene_tags / instruments /
  // emotional_arcs / sync_comparables / audience_summary. The physical
  // columns were renamed from the legacy names (venues / youtube_channels /
  // influencers / draft_emails) via scripts/rename-placement-briefs-columns.sql
  // so the DB matches the logical field names — no more column-aliasing.
  sceneTags: jsonb('scene_tags').notNull().$type<string[]>(),
  instruments: jsonb('instruments').notNull().$type<string[]>(),
  emotionalArcs: jsonb('emotional_arcs').notNull().$type<string[]>(),
  syncComparables: jsonb('sync_comparables').notNull().$type<Array<{ name: string; why: string }>>(),
  audienceSummary: text('audience_summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_placement_briefs_submission').on(table.submissionId),
]);

// ── Settlement Legs ────────────────────────────────────

export const settlementLegs = pgTable('settlement_legs', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => submissions.id),
  recipientWallet: text('recipient_wallet').notNull(),
  recipientRole: text('recipient_role').notNull(), // curator|platform|musicbrainz
  amountUsdc: text('amount_usdc').notNull(),
  txHash: text('tx_hash'),
  settledAt: timestamp('settled_at'),
  status: text('status').notNull().default('pending'), // pending|settled|failed
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // MODULAR: defense against double-publish races. If a previous publish
  // failed mid-way and the leg compensations couldn't clean up the rows,
  // the next publish's insertLegsAtomic will hit this constraint instead
  // of silently creating duplicate legs. Includes recipient_role in the
  // key because the same wallet can legitimately appear in multiple
  // roles (e.g. artistWallet is both the 'musicbrainz' recipient AND
  // falls back as the 'platform' recipient when no platform wallet is
  // configured).
  unique('uq_legs_submission_wallet_role').on(table.submissionId, table.recipientWallet, table.recipientRole),
  index('idx_settlement_submission').on(table.submissionId),
  index('idx_settlement_recipient').on(table.recipientWallet),
]);

// ── Published Versions ─────────────────────────────────

export const publishedVersions = pgTable('published_versions', {
  submissionId: text('submission_id').primaryKey().references(() => submissions.id),
  artistWallet: text('artist_wallet').notNull(),
  title: text('title').notNull(),
  artistName: text('artist_name').notNull(),
  versionType: text('version_type').notNull(),
  audioPath: text('audio_path').notNull(),
  musicbrainzId: text('musicbrainz_id'),
  coverSvg: text('cover_svg'),
  avgSoloIntensity: real('avg_solo_intensity'),
  avgVocalQuality: real('avg_vocal_quality'),
  energyConsensus: text('energy_consensus'),
  tempoConsensus: text('tempo_consensus'),
  aggregatedMoodTags: jsonb('aggregated_mood_tags').$type<string[]>(),
  ratingCount: integer('rating_count').notNull(),
  // Catalog provenance is independent of version_type and rights clearance.
  // Default live so newly published artist submissions cannot silently inherit
  // the guided-demo behavior used by deterministic seed data. 'authorized'
  // is set only when publishing an approved submission inside an active
  // version program (see publish.ts).
  catalogSource: text('catalog_source').notNull().default('live'), // demo | live | authorized
  publishedAt: timestamp('published_at').notNull(),
}, (table) => [
  index('idx_published_at').on(table.publishedAt),
  check('published_versions_catalog_source_check', sql`${table.catalogSource} IN ('demo', 'live', 'authorized')`),
]);

// ── A&R Playlists ──────────────────────────────────────

export const arPlaylists = pgTable('ar_playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  genre: text('genre'),
  mood: text('mood'),
  reasoning: text('reasoning'),
  arWallet: text('ar_wallet').notNull(),
  trackCount: integer('track_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_ar_playlists_genre').on(table.genre),
]);

// ── A&R Playlist Tracks ────────────────────────────────

export const arPlaylistTracks = pgTable('ar_playlist_tracks', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull().references(() => arPlaylists.id),
  versionId: text('version_id').notNull().references(() => publishedVersions.submissionId),
  position: integer('position').notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_playlist_track').on(table.playlistId, table.versionId),
  index('idx_ar_playlist_tracks_playlist').on(table.playlistId, table.position),
]);

// ── A&R Play Events ────────────────────────────────────

export const arPlayEvents = pgTable('ar_play_events', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull().references(() => arPlaylists.id),
  versionId: text('version_id').notNull().references(() => publishedVersions.submissionId),
  listenerWallet: text('listener_wallet').notNull(),
  artistWallet: text('artist_wallet').notNull(),
  listenerFeeUsdc: text('listener_fee_usdc').notNull(),
  artistPayoutUsdc: text('artist_payout_usdc').notNull(),
  listenerTxHash: text('listener_tx_hash'),
  artistTxHash: text('artist_tx_hash'),
  playType: text('play_type').notNull().default('paid'), // free|paid
  status: text('status').notNull().default('pending'),
  playedAt: timestamp('played_at').defaultNow().notNull(),
}, (table) => [
  index('idx_ar_play_events_playlist').on(table.playlistId),
  index('idx_ar_play_events_artist').on(table.artistWallet),
  index('idx_ar_play_events_status').on(table.status, table.playedAt),
]);

// ── Listen Events (future streaming) ────────────────────

export const listenEvents = pgTable('listen_events', {
  id: text('id').primaryKey(),
  versionId: text('version_id').notNull().references(() => publishedVersions.submissionId),
  listenerWallet: text('listener_wallet').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  ratePerSecondUsdc: text('rate_per_second_usdc').notNull(),
  amountUsdc: text('amount_usdc').notNull(),
  status: text('status').notNull().default('in_flight'),
  settlementLegId: text('settlement_leg_id').references(() => settlementLegs.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_listen_events_version').on(table.versionId),
  index('idx_listen_events_listener').on(table.listenerWallet),
  index('idx_listen_events_status').on(table.status, table.startedAt),
]);

// ── Listener Profiles ───────────────────────────────────
// Tracks free play allowance, reputation, and engagement stats per listener.

export const listenerProfiles = pgTable('listener_profiles', {
  wallet: text('wallet').primaryKey(),
  reputationScore: integer('reputation_score').notNull().default(0),
  freePlaysUsedToday: integer('free_plays_used_today').notNull().default(0),
  freePlaysDailyLimit: integer('free_plays_daily_limit').notNull().default(10),
  lastFreePlayReset: timestamp('last_free_play_reset').defaultNow().notNull(),
  totalPlays: integer('total_plays').notNull().default(0),
  totalPaidPlays: integer('total_paid_plays').notNull().default(0),
  totalFreePlays: integer('total_free_plays').notNull().default(0),
  distinctTracksPlayed: integer('distinct_tracks_played').notNull().default(0),
  lastPlayedAt: timestamp('last_played_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_listener_profiles_reputation').on(table.reputationScore),
]);

// ── Listener Badges ─────────────────────────────────────
// Milestone achievements awarded for listening engagement.

export const listenerBadges = pgTable('listener_badges', {
  id: text('id').primaryKey(),
  wallet: text('wallet').notNull().references(() => listenerProfiles.wallet),
  badgeType: text('badge_type').notNull(), // explorer|supporter|curator|tastemaker|early_adopter
  awardedAt: timestamp('awarded_at').defaultNow().notNull(),
}, (table) => [
  index('idx_listener_badges_wallet').on(table.wallet),
]);

// ── x402 Proofs (idempotency for nanopayment tips) ─────
// MODULAR: each verified x402 tip writes a row here so the same signed
// payload can't be replayed (puid is unique). This is the durable
// replacement for an in-memory Set, which is unreliable on serverless
// runtimes where a single Lambda instance can be recycled between
// the 402 challenge and the signed retry.

export const x402Proofs = pgTable('x402_proofs', {
  id: text('id').primaryKey(),
  puid: text('puid').notNull().unique(),
  resourceUrl: text('resource_url').notNull(),
  scheme: text('scheme').notNull(),
  network: text('network').notNull(),
  asset: text('asset').notNull(),
  payTo: text('pay_to').notNull(),
  amountMicroUsdc: text('amount_micro_usdc').notNull(),
  validUntil: timestamp('valid_until').notNull(),
  tipperWallet: text('tipper_wallet').notNull(),
  artistWallet: text('artist_wallet').notNull(),
  message: text('message'),
  signature: text('signature').notNull(),
  txHash: text('tx_hash'),
  status: text('status').notNull().default('verified'), // verified|settled|failed
  createdAt: timestamp('created_at').defaultNow().notNull(),
  settledAt: timestamp('settled_at'),
}, (table) => [
  index('idx_x402_proofs_tipper').on(table.tipperWallet),
  index('idx_x402_proofs_artist').on(table.artistWallet),
  index('idx_x402_proofs_status').on(table.status, table.createdAt),
]);

// ── Telemetry Events (client-side funnel analytics) ───
// MODULAR: persisted client-side analytics events. The /api/telemetry
// beacon writes rows here so the funnel can be queried via the
// /api/v1/funnel admin endpoint. Each row is one event from one
// browser session — the session ID lets us stitch a per-visitor
// funnel (landing → nav_click → form_start → submit_attempt →
// submit_success) and compute drop-off rates per step.
// Anonymous — no wallet address, no PII. Wallet state is tracked
// only as a boolean inside the props jsonb.

export const telemetryEvents = pgTable('telemetry_events', {
  id: text('id').primaryKey(),
  session: text('session').notNull(),
  event: text('event').notNull(),
  path: text('path'),
  referrer: text('referrer'),
  props: jsonb('props').notNull().default({}),
  clientTs: timestamp('client_ts'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_telemetry_session').on(table.session, table.createdAt),
  index('idx_telemetry_event').on(table.event, table.createdAt),
]);

// ── Version Embeddings (CLAP / pgvector semantic search) ───────────
// MODULAR: one row per published version, storing the CLAP audio
// embedding as a pgvector vector(512) column. The supervisor
// inverse-search embeds the brief text into the same space and
// queries for nearest neighbors by cosine distance (<=> operator).
// Backfill is a background job (embedAllPublished); new versions
// get embedded at publish time. The table is separate from
// published_versions so the embedding can be recomputed without
// touching the main row.

export const versionEmbeddings = pgTable('version_embeddings', {
  submissionId: text('submission_id').primaryKey().references(() => publishedVersions.submissionId),
  embedding: vector('embedding', { dimensions: 512 }).notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Supervisor Profiles ─────────────────────────────────
// B2B sync-first: music supervisors, A&R teams, and sync houses.

export const supervisorProfiles = pgTable('supervisor_profiles', {
  wallet: text('wallet').primaryKey().references(() => users.walletAddress),
  email: text('email'),
  name: text('name'),
  company: text('company'),
  role: text('role').default('supervisor'), // supervisor | sync_house | aandr
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_supervisor_profiles_email').on(table.email),
]);

// ── Saved Briefs ────────────────────────────────────────
// Briefs a supervisor wants to keep and reuse.

export const savedBriefs = pgTable('saved_briefs', {
  id: text('id').primaryKey(),
  supervisorWallet: text('supervisor_wallet').notNull().references(() => supervisorProfiles.wallet),
  briefText: text('brief_text').notNull(),
  filters: jsonb('filters').notNull().$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_saved_briefs_supervisor').on(table.supervisorWallet, table.createdAt),
]);

// ── Brief Searches ───────────────────────────────────────
// Audit log of every supervisor search for recent-searches UI.

export const briefSearches = pgTable('brief_searches', {
  id: text('id').primaryKey(),
  supervisorWallet: text('supervisor_wallet').notNull().references(() => supervisorProfiles.wallet),
  briefText: text('brief_text').notNull(),
  filters: jsonb('filters').notNull().$type<Record<string, unknown>>().default({}),
  resultsCount: integer('results_count').notNull().default(0),
  // Client-observed end-to-end search latency (ms). Null for rows logged
  // before the column existed; feeds the /admin/vitals latency p50/p95.
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_brief_searches_supervisor').on(table.supervisorWallet, table.createdAt),
]);

// ── Licensing Interests ────────────────────────────────
// One-click "I'm interested" tracking for supervisor workflow.

export const licensingInterests = pgTable('licensing_interests', {
  id: text('id').primaryKey(),
  supervisorWallet: text('supervisor_wallet').notNull().references(() => supervisorProfiles.wallet),
  submissionId: text('submission_id').notNull().references(() => publishedVersions.submissionId),
  status: text('status').notNull().default('interested'), // interested | contacted | licensed | passed
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_interest_supermission').on(table.supervisorWallet, table.submissionId),
  index('idx_licensing_interests_supervisor').on(table.supervisorWallet, table.createdAt),
]);

// ── Match Feedback (ground truth) ───────────────────────
// MODULAR: supervisor-labeled relevance (good_fit / wrong_fit) on a
// specific (brief → take) match, captured at the moment it's shown.
// This is the labeled set that powers the online benchmark (MRR /
// precision@k / nDCG) and, later, scorer tuning. brief_hash is a stable
// hash of the normalized brief so the same query text across supervisors
// + sessions aggregates into one benchmark query. fit_score_shown /
// rank_shown snapshot the state the supervisor actually saw.

export const matchFeedback = pgTable('match_feedback', {
  id: text('id').primaryKey(),
  supervisorWallet: text('supervisor_wallet').notNull().references(() => supervisorProfiles.wallet),
  briefHash: text('brief_hash').notNull(),
  briefText: text('brief_text').notNull(),
  submissionId: text('submission_id').notNull().references(() => publishedVersions.submissionId),
  // Snapshot the source at feedback time so later catalog edits cannot mix
  // guided-demo judgments into the production ranking benchmark. Includes
  // 'authorized' — supervisor verdicts on artist-authorized versions are
  // the highest-value ground-truth rows for the outcome graph.
  catalogSource: text('catalog_source').notNull().default('live'), // demo | live | authorized
  fitScoreShown: real('fit_score_shown').notNull(),
  rankShown: integer('rank_shown'),
  verdict: text('verdict').notNull(), // good_fit | wrong_fit
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_match_feedback_super_brief_sub').on(table.supervisorWallet, table.briefHash, table.submissionId),
  index('idx_match_feedback_brief_hash').on(table.briefHash),
  index('idx_match_feedback_verdict_created').on(table.verdict, table.createdAt),
  check('match_feedback_catalog_source_check', sql`${table.catalogSource} IN ('demo', 'live', 'authorized')`),
]);

// ── Licenses ────────────────────────────────────────────
// MODULAR: turning the "licensed" status string into a real, settled
// outcome. A license records the deal (take + brief + usage + fee) and
// the on-chain payment that clears it. Status: pending_payment → paid
// (tx_hash + mock flag + settled_at). The price is derived from usage
// via src/lib/pricing.ts. settlement happens in the pay route via the
// Arc adapter (platform-brokered in this first non-scaling cut).

// ── Placement Cases ─────────────────────────────────────
// MODULAR: the persistent work object at the heart of the
// supervisor experience. A case IS the brief + the agent's plan +
// the evidence + the ONE human decision it is waiting on. It
// survives sessions so the supervisor can leave, return tomorrow,
// and read "your night-drive placement case is waiting on one
// decision". Additive — it anchors onto (does not replace) the
// existing saved_briefs / licensing_interests / licenses rails.
//
// `status` lifecycle: open → awaiting_decision → rights_review →
// settlement_ready → settled (or archived). `pending_decision` is
// the natural-language description of the single gate the agent is
// waiting to clear. `agent_plan` is the ordered, named progress the
// agent owns; the human owns `pending_decision`.

export interface PlaceCaseStep {
  key: string;
  label: string;
  done: boolean;
  current?: boolean;
}

export interface PlaceCaseEvidence {
  rankedCount?: number;
  shortlistSubmissionIds?: string[];
  recommendationText?: string;
}

export const placementCases = pgTable(
  'placement_cases',
  {
    id: text('id').primaryKey(),
    supervisorWallet: text('supervisor_wallet')
      .notNull()
      .references(() => supervisorProfiles.wallet),
    kind: text('kind').notNull().default('placement'), // placement | release | rights | settlement
    briefText: text('brief_text').notNull(),
    // Authoritative link to the business resource driving this case. A
    // placement case links a license once licensing starts; a release case
    // will link a submission. State transitions are validated against these
    // real resources — never against free-form status strings.
    licenseId: text('license_id').references(() => licenses.id),
    submissionId: text('submission_id').references(() => submissions.id),
    status: text('status').notNull().default('open'), // open | awaiting_decision | rights_review | settlement_ready | settled | archived
    objective: text('objective'),
    pendingDecision: text('pending_decision'),
    agentPlan: jsonb('agent_plan').$type<PlaceCaseStep[]>().notNull().default([]),
    evidence: jsonb('evidence').$type<PlaceCaseEvidence>().notNull().default({}),
    lastActivity: timestamp('last_activity').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_placement_cases_supervisor').on(table.supervisorWallet, table.lastActivity),
    // Race-safe active-case idempotency: at most ONE non-terminal case per
    // (supervisor, brief). Once a case is settled/archived a new one may open.
    uniqueIndex('uq_placement_cases_active_brief')
      .on(table.supervisorWallet, table.briefText)
      .where(sql`${table.status} NOT IN ('settled', 'archived')`),
  ],
);

// ── Case events ──────────────────────────────────────────
// Durable, per-case activity trail — the audit record of what the
// agent did for MY brief (not a public stream). "Interpreted the
// brief", "Ranked 42 takes", "Needs your judgment", "Rights review
// begins", "Settled".

export const caseEvents = pgTable(
  'case_events',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => placementCases.id),
    kind: text('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_case_events_case').on(table.caseId, table.createdAt)],
);

// ── Release Cases ───────────────────────────────────────
// An ARTIST's root job. Owned by the artist wallet (NOT a supervisor) and
// hard-linked to the real submission_id — the submission record is the
// authoritative source of truth, so a release case's visual state is always
// re-derived from the linked submission and can never drift from payment /
// curation reality. `agent_plan` is a snapshot the render path refreshes.

export interface ReleaseCaseStep {
  key: string;
  label: string;
  done: boolean;
  current?: boolean;
}

export const releaseCases = pgTable(
  'release_cases',
  {
    id: text('id').primaryKey(),
    artistWallet: text('artist_wallet')
      .notNull()
      .references(() => users.walletAddress),
    submissionId: text('submission_id')
      .notNull()
      .references(() => submissions.id),
    title: text('title').notNull(),
    artistName: text('artist_name').notNull(),
    versionType: text('version_type'),
    coverSvg: text('cover_svg'),
    submissionStatus: text('submission_status').notNull().default('pending_payment'),
    agentPlan: jsonb('agent_plan').$type<ReleaseCaseStep[]>().notNull().default([]),
    lastActivity: timestamp('last_activity').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_release_cases_artist').on(table.artistWallet, table.lastActivity),
    unique('uq_release_case_submission').on(table.submissionId),
  ],
);

export const licenses = pgTable('licenses', {
  id: text('id').primaryKey(),
  supervisorWallet: text('supervisor_wallet').notNull().references(() => supervisorProfiles.wallet),
  submissionId: text('submission_id').notNull().references(() => publishedVersions.submissionId),
  briefHash: text('brief_hash').notNull(),
  briefText: text('brief_text').notNull(),
  usageType: text('usage_type').notNull(), // sync_ad | sync_tv_film | sync_digital | other
  territory: text('territory').notNull().default('worldwide'),
  termMonths: integer('term_months').notNull().default(12),
  feeUsdc: text('fee_usdc').notNull(),
  status: text('status').notNull().default('pending_payment'), // pending_payment | settling | paid
  paymentTxHash: text('payment_tx_hash'),
  paymentMock: boolean('payment_mock').notNull().default(false),
  // Opaque owner token for a fail-closed settlement claim. It prevents a
  // stale worker from releasing or completing another worker's settlement.
  settlementLeaseId: text('settlement_lease_id'),
  // MODULAR: ERC-8183 job receipt — license = Agentic Commerce job.
  jobId: text('job_id'),
  jobStatus: text('job_status'), // Open | Funded | Submitted | Completed | …
  deliverableHash: text('deliverable_hash'),
  jobCreateTxHash: text('job_create_tx_hash'),
  jobCompleteTxHash: text('job_complete_tx_hash'),
  settledAt: timestamp('settled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_license_super_sub_brief').on(table.supervisorWallet, table.submissionId, table.briefHash),
  index('idx_licenses_supervisor').on(table.supervisorWallet, table.createdAt),
]);

// ── Outbox (durable event replay) ───────────────────────
// MODULAR: transactional-ish event persistence for the canonical receipt
// stream (settlement / tip / play / economy). The in-process EventBus is
// fire-and-forget — if the process dies between a settle and an SSE client
// reading it, that receipt is lost. Every durable emit is additionally
// written here; a cron/SSE drain replays unprocessed rows into the bus so
// the receipt is at-least-once delivered without blocking the fast path.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    topic: text('topic').notNull(), // 'settlement-event' | 'economy-event' | 'feed-update' | …
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
  },
  (table) => [index('idx_outbox_unprocessed').on(table.processedAt, table.createdAt)],
);
