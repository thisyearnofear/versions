import { sql } from 'drizzle-orm';
import { pgTable, text, integer, real, timestamp, index, unique, uniqueIndex, jsonb, boolean, customType, check } from 'drizzle-orm/pg-core';
import type {
  AgentDetail,
  AudioFeatures,
  ChannelPlatform,
  ChannelStatus,
  ChannelVerification,
  Disclosure,
  ListingKind,
  ListingPricing,
  ListingStatus,
  ListingTier,
  PricingModel,
  SlotRecipientRole,
  SlotStatus,
  StatsSource,
  UsageKind,
  UsageReportedBy,
} from './types';

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
  // Audio features extracted from the source audio for agent scoring.
  // Populated at publish time by the feature extraction pipeline.
  // Kept in the marketplace pivot: tempo/energy/valence are a real signal
  // for whether a track fits a channel's ethos.
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

// ── Listings (unified marketplace supply) ─────────────
// MODULAR: ONE primitive, TWO supply catalogs. A listing is a slot in a
// feed that a distribution channel can pick up — either a track (`music`)
// or a brand/product (`placement`). Both are embedded into the same vector
// space as channel ethos, both are free-with-attribution or paid, and both
// settle through the same flat three-leg split. There is deliberately no
// per-listing licensing negotiation: one blanket agreement covers every
// free use, and a paid listing is a self-serve buy.
//
// `music` listings link to a submission so the existing upload pipeline
// (audio bytes, sha256 dedup, feature extraction, cover generation) is
// reused rather than rebuilt. `placement` listings carry their own
// brand/product fields inline.
export const listings = pgTable('listings', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().$type<ListingKind>(), // music | placement
  supplierWallet: text('supplier_wallet').notNull().references(() => users.walletAddress),
  // Music only: the uploaded track this listing offers.
  submissionId: text('submission_id').references(() => submissions.id),
  title: text('title').notNull(),
  // Artist name (music) or brand name (placement).
  supplierName: text('supplier_name').notNull(),
  // Short pitch. For placements this is the advertiser's copy; for music it
  // is the track description.
  summary: text('summary'),
  // Mood/genre tags (music) or target ethos tags (placement). Same column,
  // same matcher — that is the point of the unified primitive.
  tags: jsonb('tags').notNull().$type<string[]>(),
  // Placement creative. Music listings leave this empty and use cover_svg.
  images: jsonb('images').notNull().$type<string[]>(),
  coverSvg: text('cover_svg'),
  audioPath: text('audio_path'),
  audioFeatures: jsonb('audio_features').$type<AudioFeatures | null>(),

  tier: text('tier').notNull().$type<ListingTier>(), // free | paid
  // Paid only. { model: 'flat' | 'cpm', flatFeeUsdc?, cpmUsdc? }
  pricing: jsonb('pricing').$type<ListingPricing | null>(),
  // Campaign budget cap in decimal USDC. NULL = uncapped. Once spend reaches
  // the cap the listing stops serving (status → 'exhausted').
  budgetCapUsdc: text('budget_cap_usdc'),
  // Committed campaign spend: reserved by one atomic guarded UPDATE when a
  // slot is paid, released when a CPM slot completes with escrow left over.
  // Delivery accrual never touches it — a slot's own capped budget bounds what
  // it can serve, and every slot budget is clamped to this headroom at
  // creation, so total delivery cannot exceed total commitment.
  budgetSpentUsdc: text('budget_spent_usdc').notNull().default('0'),
  // Compliance surface. Required on every paid listing: FTC / platform
  // sponsored-content rules apply to AI-run channels exactly as they do to
  // human ones. Generated into the attribution string the channel renders.
  disclosure: jsonb('disclosure').$type<Disclosure | null>(),

  // Attribution is enforced at the product level, not by asking nicely.
  // Generated at creation, NCS-style: name + link back.
  attributionText: text('attribution_text').notNull(),
  attributionUrl: text('attribution_url').notNull(),
  // Short stable handle used in tracking links and attribution codes.
  attributionSlug: text('attribution_slug').notNull().unique(),

  // Blanket click-through agreement, accepted once at creation — not per
  // transaction. The version is recorded so a ToS change is auditable.
  agreementVersion: text('agreement_version').notNull(),
  agreementAcceptedAt: timestamp('agreement_accepted_at').notNull(),

  status: text('status').notNull().default('draft').$type<ListingStatus>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_listings_kind_status').on(table.kind, table.status),
  index('idx_listings_supplier').on(table.supplierWallet),
  index('idx_listings_tier').on(table.tier, table.status),
  check('listings_kind_check', sql`${table.kind} IN ('music', 'placement')`),
  check('listings_tier_check', sql`${table.tier} IN ('free', 'paid')`),
  // A paid listing must be priceable; a free listing must not be.
  check(
    'listings_paid_needs_pricing',
    sql`(${table.tier} = 'paid') = (${table.pricing} IS NOT NULL)`,
  ),
  // Disclosure is mandatory on paid supply and forbidden on free supply.
  check(
    'listings_paid_needs_disclosure',
    sql`(${table.tier} = 'paid') = (${table.disclosure} IS NOT NULL)`,
  ),
]);

// ── Listing embeddings ────────────────────────────────
// Both listing kinds are embedded into the SAME space as channel ethos so a
// single cosine query surfaces either kind against a channel profile. Kept
// in its own table (rather than a column on listings) so vectors can be
// recomputed or backfilled without touching the supply row.
export const listingEmbeddings = pgTable('listing_embeddings', {
  listingId: text('listing_id').primaryKey().references(() => listings.id),
  embedding: vector('embedding', { dimensions: 512 }).notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Channels (distribution side) ──────────────────────
// MODULAR: the buyer/user of supply is an AI-run distribution channel —
// YouTube automation, radio-style feeds, and the like. A channel connects a
// REAL distribution surface and we pull its numbers from the platform's own
// API. Self-reported reach is never accepted: fake distribution is the fraud
// that undermines ad marketplaces, so `stats_source` has no 'self_reported'
// member and `verification_status` gates whether a channel can buy a slot.
//
// The ethos fields (niche, self-description, recent content) are the input
// to the channel embedding that listings are matched against.
export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  ownerWallet: text('owner_wallet').notNull().references(() => users.walletAddress),
  name: text('name').notNull(),
  platform: text('platform').notNull().$type<ChannelPlatform>(), // youtube | other
  // The connected distribution surface, e.g. a YouTube channel URL.
  platformUrl: text('platform_url').notNull(),
  // Resolved external id (YouTube `UC…`). Set by verification, never by the
  // channel operator.
  platformChannelId: text('platform_channel_id'),
  verificationStatus: text('verification_status').notNull().default('pending').$type<ChannelVerification>(),
  verificationError: text('verification_error'),

  subscriberCount: integer('subscriber_count'),
  viewCount: text('view_count'),
  videoCount: integer('video_count'),
  statsSource: text('stats_source').$type<StatsSource | null>(),
  statsVerifiedAt: timestamp('stats_verified_at'),

  // Ethos profile — the embedding input. `niche` and `ethosSummary` are
  // operator-typed; `platformDescription` and `recentContent` are pulled from
  // the platform by verification. Kept in separate columns so self-described
  // text is never indistinguishable from platform-verified text.
  niche: text('niche'),
  ethosSummary: text('ethos_summary'),
  platformDescription: text('platform_description'),
  recentContent: jsonb('recent_content').notNull().$type<string[]>(),

  // Blanket click-through agreement, accepted once at registration.
  agreementVersion: text('agreement_version').notNull(),
  agreementAcceptedAt: timestamp('agreement_accepted_at').notNull(),

  status: text('status').notNull().default('active').$type<ChannelStatus>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // One channel row per real distribution surface.
  unique('uq_channels_platform_channel').on(table.platform, table.platformChannelId),
  index('idx_channels_owner').on(table.ownerWallet),
  index('idx_channels_verification').on(table.verificationStatus),
  check('channels_platform_check', sql`${table.platform} IN ('youtube', 'other')`),
  check('channels_stats_source_check', sql`${table.statsSource} IN ('platform_api', 'mock')`),
]);

export const channelEmbeddings = pgTable('channel_embeddings', {
  channelId: text('channel_id').primaryKey().references(() => channels.id),
  embedding: vector('embedding', { dimensions: 512 }).notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Slots (paid tier — the ad infra) ──────────────────
// MODULAR: a slot is a purchased placement of a listing on a channel. It is
// self-serve by design: set a budget, pick flat-fee or CPM, check out on the
// existing Arc/x402 rails — no sales call, no bespoke contract. Every slot
// mints a unique tracking code at creation so impressions and clicks can be
// attributed back to it before the first advertiser asks for proof.
export const slots = pgTable('slots', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => listings.id),
  channelId: text('channel_id').notNull().references(() => channels.id),
  buyerWallet: text('buyer_wallet').notNull(),
  pricingModel: text('pricing_model').notNull().$type<PricingModel>(), // flat | cpm
  flatFeeUsdc: text('flat_fee_usdc'),
  cpmUsdc: text('cpm_usdc'),
  // Campaign cap for this slot. NULL = no cap. Enforced by the same guarded
  // atomic UPDATE that moves spent_usdc.
  budgetUsdc: text('budget_usdc'),
  spentUsdc: text('spent_usdc').notNull().default('0'),
  impressionsDelivered: integer('impressions_delivered').notNull().default(0),
  clicksDelivered: integer('clicks_delivered').notNull().default(0),
  // Unique trackable identifier + the link that carries it.
  trackingCode: text('tracking_code').notNull().unique(),
  trackingUrl: text('tracking_url').notNull(),
  // Copied from the listing at purchase so the served creative always
  // carries its disclosure even if the listing is later edited.
  disclosure: jsonb('disclosure').notNull().$type<Disclosure>(),
  attributionText: text('attribution_text').notNull(),
  status: text('status').notNull().default('pending_payment').$type<SlotStatus>(),
  paymentTxHash: text('payment_tx_hash'),
  paymentMock: boolean('payment_mock').notNull().default(false),
  // Opaque owner token for a fail-closed settlement claim, same pattern as
  // licenses.settlement_lease_id: a stale worker cannot release or complete
  // another worker's settlement.
  settlementLeaseId: text('settlement_lease_id'),
  settledAt: timestamp('settled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // A channel cannot hold two live slots for the same listing.
  uniqueIndex('uq_slots_active_listing_channel')
    .on(table.listingId, table.channelId)
    .where(sql`${table.status} IN ('pending_payment', 'active', 'paused')`),
  index('idx_slots_channel').on(table.channelId, table.status),
  index('idx_slots_listing').on(table.listingId, table.status),
  index('idx_slots_buyer').on(table.buyerWallet),
  check('slots_pricing_model_check', sql`${table.pricingModel} IN ('flat', 'cpm')`),
]);

// ── Slot settlement legs (flat three-way split) ───────
// MODULAR: paid-slot money. Deliberately a SEPARATE table from
// settlement_legs so the existing publish-fee leg-count invariants and the
// uq_legs_submission_wallet_role constraint stay byte-for-byte intact while
// slot settlement gets its own, simpler contract: EXACTLY three legs —
// supplier, channel, platform — with no waterfall. All three columns of the
// unique key are NOT NULL, so duplicate-insert protection actually holds
// (Postgres treats NULLs as distinct, which would silently defeat it).
export const slotLegs = pgTable('slot_legs', {
  id: text('id').primaryKey(),
  slotId: text('slot_id').notNull().references(() => slots.id),
  recipientWallet: text('recipient_wallet').notNull(),
  recipientRole: text('recipient_role').notNull().$type<SlotRecipientRole>(), // supplier|channel|platform
  amountUsdc: text('amount_usdc').notNull(),
  txHash: text('tx_hash'),
  settledAt: timestamp('settled_at'),
  status: text('status').notNull().default('pending'), // pending|settled|failed
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_slot_legs_slot_wallet_role').on(table.slotId, table.recipientWallet, table.recipientRole),
  index('idx_slot_legs_slot').on(table.slotId),
  index('idx_slot_legs_recipient').on(table.recipientWallet, table.status),
  check('slot_legs_role_check', sql`${table.recipientRole} IN ('supplier', 'channel', 'platform')`),
]);

// ── Usage events (the data flywheel) ──────────────────
// MODULAR: every use of every listing is logged — which channel, which
// listing, when, and where (video URL when available). Organic rows are the
// free tier's attribution-compliance record and the future matching-quality
// signal; sponsored rows carry the tracking code and the spend that the
// budget cap is enforced against. Also the sales proof for the paid side
// ("our catalog gets used X times a month").
//
// Reported-by is recorded rather than assumed: platform APIs are limited, so
// a channel-reported or manually-entered row is legitimate — but it must
// never be indistinguishable from a platform-verified one.
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => listings.id),
  channelId: text('channel_id').notNull().references(() => channels.id),
  // Set when the usage was delivered under a paid slot.
  slotId: text('slot_id').references(() => slots.id),
  kind: text('kind').notNull().$type<UsageKind>(), // organic | sponsored
  attributionCode: text('attribution_code'),
  videoUrl: text('video_url'),
  externalContentId: text('external_content_id'),
  impressions: integer('impressions').notNull().default(1),
  clicks: integer('clicks').notNull().default(0),
  // Spend accrued by this event (CPM slots) or 0 (organic / flat).
  spendUsdc: text('spend_usdc').notNull().default('0'),
  reportedBy: text('reported_by').notNull().$type<UsageReportedBy>(),
  status: text('status').notNull().default('logged'), // logged|counted|rejected
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_usage_listing').on(table.listingId, table.occurredAt),
  index('idx_usage_channel').on(table.channelId, table.occurredAt),
  index('idx_usage_slot').on(table.slotId),
  index('idx_usage_kind').on(table.kind, table.occurredAt),
  check('usage_events_kind_check', sql`${table.kind} IN ('organic', 'sponsored')`),
  check('usage_events_reported_by_check', sql`${table.reportedBy} IN ('channel', 'platform_api', 'manual')`),
  // Sponsored usage must name the slot it was served under, and must carry
  // its tracking code — that is what makes the spend attributable.
  check(
    'usage_events_sponsored_needs_slot',
    sql`(${table.kind} = 'sponsored') = (${table.slotId} IS NOT NULL)`,
  ),
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
  // Catalog provenance is independent of version_type. Default live so newly
  // published artist submissions cannot silently inherit the guided-demo
  // behavior used by deterministic seed data.
  catalogSource: text('catalog_source').notNull().default('live'), // demo | live
  publishedAt: timestamp('published_at').notNull(),
  // MODULAR: version family grouping. When set, this submission is part of a
  // version family (alternate takes of the same source song). Enables
  // DiscoverView to group related versions together with expandable sibling
  // panels and the A/B compare transport.
  familyId: text('family_id'),
}, (table) => [
  index('idx_published_at').on(table.publishedAt),
  check('published_versions_catalog_source_check', sql`${table.catalogSource} IN ('demo', 'live')`),
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
  // guided-demo judgments into the production ranking benchmark.
  catalogSource: text('catalog_source').notNull().default('live'), // demo | live
  fitScoreShown: real('fit_score_shown').notNull(),
  rankShown: integer('rank_shown'),
  verdict: text('verdict').notNull(), // good_fit | wrong_fit
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uq_match_feedback_super_brief_sub').on(table.supervisorWallet, table.briefHash, table.submissionId),
  index('idx_match_feedback_brief_hash').on(table.briefHash),
  index('idx_match_feedback_verdict_created').on(table.verdict, table.createdAt),
  check('match_feedback_catalog_source_check', sql`${table.catalogSource} IN ('demo', 'live')`),
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
