import { pgTable, text, integer, real, timestamp, index, unique, jsonb, boolean } from 'drizzle-orm/pg-core';

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
  // index. The market agent now emits scene_tags / instruments /
  // emotional_arcs / sync_comparables / audience_summary instead of the
  // prior venues / youtube_channels / influencers / draft_emails /
  // audience_summary shape. We bind the existing NOT NULL jsonb
  // columns to new logical field names via Drizzle column-aliasing
  // (jsonb('venues').$type<string[]>()) so the DB stays untouched —
  // old rows are semantically orphan but stay valid Drizzle-wise (they
  // were never read). No migration needed.
  sceneTags: jsonb('venues').notNull().$type<string[]>(),
  instruments: jsonb('youtube_channels').notNull().$type<string[]>(),
  emotionalArcs: jsonb('influencers').notNull().$type<string[]>(),
  syncComparables: jsonb('draft_emails').notNull().$type<Array<{ name: string; why: string }>>(),
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
  publishedAt: timestamp('published_at').notNull(),
}, (table) => [
  index('idx_published_at').on(table.publishedAt),
]);

// ── A&R Playlists ──────────────────────────────────────

export const arPlaylists = pgTable('ar_playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  genre: text('genre'),
  mood: text('mood'),
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
