// MODULAR: PGlite-backed test DB fixture.
// One in-memory Postgres per test file; schema is applied from src/lib/schema
// via a hand-rolled DDL (drizzle-kit is overkill for tests). Services import
// the singleton via `@/lib/db`, so we use vi.mock to inject this db.

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

let _pg: PGlite | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

// Hand-rolled DDL from src/lib/schema.ts. PGlite supports the same
// Postgres DDL the schema uses.
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  artist_wallet TEXT NOT NULL,
  audius_track_id TEXT,
  musicbrainz_id TEXT,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT NOT NULL,
  genre TEXT,
  artist_mood TEXT,
  description TEXT,
  audio_path TEXT NOT NULL,
  audio_duration_seconds INTEGER,
  audio_size_bytes INTEGER NOT NULL,
  audio_sha256 TEXT,
  content_type TEXT NOT NULL,
  fee_quote_usdc TEXT NOT NULL,
  cover_svg TEXT,
  audio_features JSONB,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  payment_tx_hash TEXT,
  payment_verified_at TIMESTAMP,
  rating_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_submissions_artist ON submissions(artist_wallet);
CREATE UNIQUE INDEX IF NOT EXISTS uq_audio_sha256_wallet ON submissions(audio_sha256, artist_wallet);

-- MODULAR: unified marketplace supply. ONE primitive, TWO catalogs — a
-- music listing links to a submission, a placement listing carries its
-- own brand/product fields. Both are embedded into the same vector space as
-- channel ethos and both settle through the same flat three-leg split.
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('music', 'placement')),
  supplier_wallet TEXT NOT NULL,
  submission_id TEXT REFERENCES submissions(id),
  title TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  summary TEXT,
  tags JSONB NOT NULL,
  images JSONB NOT NULL,
  cover_svg TEXT,
  audio_path TEXT,
  audio_features JSONB,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'paid')),
  pricing JSONB,
  budget_cap_usdc TEXT,
  budget_spent_usdc TEXT NOT NULL DEFAULT '0',
  disclosure JSONB,
  attribution_text TEXT NOT NULL,
  attribution_url TEXT NOT NULL,
  attribution_slug TEXT NOT NULL UNIQUE,
  agreement_version TEXT NOT NULL,
  agreement_accepted_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- A paid listing must be priceable; a free listing must not be.
  CHECK ((tier = 'paid') = (pricing IS NOT NULL)),
  -- Disclosure is mandatory on paid supply and forbidden on free supply.
  CHECK ((tier = 'paid') = (disclosure IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_listings_kind_status ON listings(kind, status);
CREATE INDEX IF NOT EXISTS idx_listings_supplier ON listings(supplier_wallet);
CREATE INDEX IF NOT EXISTS idx_listings_tier ON listings(tier, status);

-- PGlite has no pgvector, so embedding is TEXT here (see version_embeddings).
CREATE TABLE IF NOT EXISTS listing_embeddings (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id),
  embedding TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- MODULAR: the distribution side. A channel connects a REAL surface and the
-- numbers come from the platform's own API — stats_source deliberately has no
-- 'self_reported' arm, because invented reach is the fraud that undermines
-- ad marketplaces.
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'other')),
  platform_url TEXT NOT NULL,
  platform_channel_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_error TEXT,
  subscriber_count INTEGER,
  view_count INTEGER,
  video_count INTEGER,
  stats_source TEXT CHECK (stats_source IN ('platform_api', 'mock')),
  stats_verified_at TIMESTAMP,
  niche TEXT,
  ethos_summary TEXT,
  platform_description TEXT,
  recent_content JSONB NOT NULL,
  agreement_version TEXT NOT NULL,
  agreement_accepted_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_platform_channel ON channels(platform, platform_channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_channels_verification ON channels(verification_status);

CREATE TABLE IF NOT EXISTS channel_embeddings (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id),
  embedding TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- MODULAR: the paid tier. Self-serve by design; every slot mints a unique
-- tracking code at creation so impressions are attributable from day one.
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  buyer_wallet TEXT NOT NULL,
  pricing_model TEXT NOT NULL CHECK (pricing_model IN ('flat', 'cpm')),
  flat_fee_usdc TEXT,
  cpm_usdc TEXT,
  budget_usdc TEXT,
  spent_usdc TEXT NOT NULL DEFAULT '0',
  impressions_delivered INTEGER NOT NULL DEFAULT 0,
  clicks_delivered INTEGER NOT NULL DEFAULT 0,
  tracking_code TEXT NOT NULL UNIQUE,
  tracking_url TEXT NOT NULL,
  disclosure JSONB NOT NULL,
  attribution_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  payment_tx_hash TEXT,
  payment_mock BOOLEAN NOT NULL DEFAULT FALSE,
  settlement_lease_id TEXT,
  settled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slots_active_listing_channel
  ON slots(listing_id, channel_id)
  WHERE status IN ('pending_payment', 'active', 'paused');
CREATE INDEX IF NOT EXISTS idx_slots_channel ON slots(channel_id, status);
CREATE INDEX IF NOT EXISTS idx_slots_listing ON slots(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_slots_buyer ON slots(buyer_wallet);

-- MODULAR: paid-slot money. Deliberately SEPARATE from settlement_legs so the
-- publish-fee leg-count invariants and uq_legs_submission_wallet_role stay
-- byte-for-byte intact. Simpler contract: EXACTLY three flat legs —
-- supplier, channel, platform — no waterfall. All three unique-key columns
-- are NOT NULL so duplicate-insert protection actually holds.
CREATE TABLE IF NOT EXISTS slot_legs (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id),
  recipient_wallet TEXT NOT NULL,
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('supplier', 'channel', 'platform')),
  amount_usdc TEXT NOT NULL,
  tx_hash TEXT,
  settled_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_legs_slot_wallet_role ON slot_legs(slot_id, recipient_wallet, recipient_role);
CREATE INDEX IF NOT EXISTS idx_slot_legs_slot ON slot_legs(slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_legs_recipient ON slot_legs(recipient_wallet, status);

-- MODULAR: the data flywheel. Every use of every listing is logged, with
-- reported_by recorded rather than assumed so a channel-reported row is never
-- indistinguishable from a platform-verified one.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  slot_id TEXT REFERENCES slots(id),
  kind TEXT NOT NULL CHECK (kind IN ('organic', 'sponsored')),
  attribution_code TEXT,
  video_url TEXT,
  external_content_id TEXT,
  impressions INTEGER NOT NULL DEFAULT 1,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend_usdc TEXT NOT NULL DEFAULT '0',
  reported_by TEXT NOT NULL CHECK (reported_by IN ('channel', 'platform_api', 'manual')),
  status TEXT NOT NULL DEFAULT 'logged',
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Sponsored usage must name the slot it was served under.
  CHECK ((kind = 'sponsored') = (slot_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_usage_listing ON usage_events(listing_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_channel ON usage_events(channel_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_slot ON usage_events(slot_id);
CREATE INDEX IF NOT EXISTS idx_usage_kind ON usage_events(kind, occurred_at);

CREATE TABLE IF NOT EXISTS curator_claims (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  curator_wallet TEXT NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  released_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_submission_curator ON curator_claims(submission_id, curator_wallet);
CREATE INDEX IF NOT EXISTS idx_claims_submission ON curator_claims(submission_id);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  curator_wallet TEXT NOT NULL,
  solo_intensity INTEGER NOT NULL,
  vocal_quality INTEGER NOT NULL,
  energy_vs_studio TEXT NOT NULL,
  tempo_feel TEXT NOT NULL,
  mood_tags JSONB NOT NULL,
  notes TEXT,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_submission_curator ON ratings(submission_id, curator_wallet);
CREATE INDEX IF NOT EXISTS idx_ratings_submission ON ratings(submission_id);

CREATE TABLE IF NOT EXISTS agent_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  curator_wallet TEXT NOT NULL,
  solo_intensity INTEGER NOT NULL,
  vocal_quality INTEGER NOT NULL,
  energy_vs_studio TEXT NOT NULL,
  tempo_feel TEXT NOT NULL,
  mood_tags JSONB NOT NULL,
  notes TEXT,
  raw_response TEXT,
  detail JSONB,
  fit_score INTEGER,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_review ON agent_reviews(submission_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_submission ON agent_reviews(submission_id);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox_events(processed_at, created_at);

CREATE TABLE IF NOT EXISTS placement_briefs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL DEFAULT 'market',
  scene_tags JSONB NOT NULL,
  instruments JSONB NOT NULL,
  emotional_arcs JSONB NOT NULL,
  sync_comparables JSONB NOT NULL,
  audience_summary TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_placement_briefs_submission ON placement_briefs(submission_id);

CREATE TABLE IF NOT EXISTS settlement_legs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  recipient_wallet TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  tx_hash TEXT,
  settled_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- MODULAR: defense against double-publish races. If a previous publish's
-- leg compensations failed to clean up the rows, the next publish's
-- insertLegsAtomic will hit this unique constraint instead of creating
-- duplicate legs for the same (submission, wallet, role) tuple.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legs_submission_wallet_role ON settlement_legs(submission_id, recipient_wallet, recipient_role);
CREATE INDEX IF NOT EXISTS idx_settlement_submission ON settlement_legs(submission_id);
CREATE INDEX IF NOT EXISTS idx_settlement_recipient ON settlement_legs(recipient_wallet);

CREATE TABLE IF NOT EXISTS published_versions (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  artist_wallet TEXT NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  musicbrainz_id TEXT,
  cover_svg TEXT,
  avg_solo_intensity REAL,
  avg_vocal_quality REAL,
  energy_consensus TEXT,
  tempo_consensus TEXT,
  aggregated_mood_tags JSONB,
  rating_count INTEGER NOT NULL,
  catalog_source TEXT NOT NULL DEFAULT 'live' CHECK (catalog_source IN ('demo', 'live')),
  published_at TIMESTAMP NOT NULL,
  family_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_published_at ON published_versions(published_at);

CREATE TABLE IF NOT EXISTS ar_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  mood TEXT,
  reasoning TEXT,
  ar_wallet TEXT NOT NULL,
  track_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ar_playlists_genre ON ar_playlists(genre);

CREATE TABLE IF NOT EXISTS ar_playlist_tracks (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_track ON ar_playlist_tracks(playlist_id, version_id);
CREATE INDEX IF NOT EXISTS idx_ar_playlist_tracks_playlist ON ar_playlist_tracks(playlist_id, position);

CREATE TABLE IF NOT EXISTS ar_play_events (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  listener_wallet TEXT NOT NULL,
  artist_wallet TEXT NOT NULL,
  listener_fee_usdc TEXT NOT NULL,
  artist_payout_usdc TEXT NOT NULL,
  listener_tx_hash TEXT,
  artist_tx_hash TEXT,
  play_type TEXT NOT NULL DEFAULT 'paid',
  status TEXT NOT NULL DEFAULT 'pending',
  played_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ar_play_events_playlist ON ar_play_events(playlist_id);
CREATE INDEX IF NOT EXISTS idx_ar_play_events_artist ON ar_play_events(artist_wallet);
CREATE INDEX IF NOT EXISTS idx_ar_play_events_status ON ar_play_events(status, played_at);

CREATE TABLE IF NOT EXISTS listen_events (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  listener_wallet TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  rate_per_second_usdc TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_flight',
  settlement_leg_id TEXT REFERENCES settlement_legs(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listen_events_version ON listen_events(version_id);
CREATE INDEX IF NOT EXISTS idx_listen_events_listener ON listen_events(listener_wallet);
CREATE INDEX IF NOT EXISTS idx_listen_events_status ON listen_events(status, started_at);

CREATE TABLE IF NOT EXISTS listener_profiles (
  wallet TEXT PRIMARY KEY,
  reputation_score INTEGER NOT NULL DEFAULT 0,
  free_plays_used_today INTEGER NOT NULL DEFAULT 0,
  free_plays_daily_limit INTEGER NOT NULL DEFAULT 10,
  last_free_play_reset TIMESTAMP NOT NULL DEFAULT NOW(),
  total_plays INTEGER NOT NULL DEFAULT 0,
  total_paid_plays INTEGER NOT NULL DEFAULT 0,
  total_free_plays INTEGER NOT NULL DEFAULT 0,
  distinct_tracks_played INTEGER NOT NULL DEFAULT 0,
  last_played_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listener_profiles_reputation ON listener_profiles(reputation_score);

CREATE TABLE IF NOT EXISTS listener_badges (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES listener_profiles(wallet),
  badge_type TEXT NOT NULL,
  awarded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listener_badges_wallet ON listener_badges(wallet);

CREATE TABLE IF NOT EXISTS x402_proofs (
  id TEXT PRIMARY KEY,
  puid TEXT NOT NULL UNIQUE,
  resource_url TEXT NOT NULL,
  scheme TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  amount_micro_usdc TEXT NOT NULL,
  valid_until TIMESTAMP NOT NULL,
  tipper_wallet TEXT NOT NULL,
  artist_wallet TEXT NOT NULL,
  message TEXT,
  signature TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'verified',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_x402_proofs_tipper ON x402_proofs(tipper_wallet);
CREATE INDEX IF NOT EXISTS idx_x402_proofs_artist ON x402_proofs(artist_wallet);
CREATE INDEX IF NOT EXISTS idx_x402_proofs_status ON x402_proofs(status, created_at);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  event TEXT NOT NULL,
  path TEXT,
  referrer TEXT,
  props JSONB NOT NULL DEFAULT '{}',
  client_ts TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_events(session, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_event ON telemetry_events(event, created_at);

-- MODULAR: version_embeddings table for CLAP semantic search.
-- PGlite doesn't support the pgvector extension, so we use TEXT
-- instead of vector(512). The embedding service stores the vector
-- as a string like "[0.1,0.2,...]" — the Drizzle customType's
-- toDriver/fromDriver handles the serialization. Tests that need
-- to query by cosine distance use the pure cosineSimilarity function
-- instead of the pgvector <=> operator.
CREATE TABLE IF NOT EXISTS version_embeddings (
  submission_id TEXT PRIMARY KEY REFERENCES published_versions(submission_id),
  embedding TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supervisor_profiles (
  wallet TEXT PRIMARY KEY REFERENCES users(wallet_address),
  email TEXT,
  name TEXT,
  company TEXT,
  role TEXT DEFAULT 'supervisor',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supervisor_profiles_email ON supervisor_profiles(email);

CREATE TABLE IF NOT EXISTS saved_briefs (
  id TEXT PRIMARY KEY,
  supervisor_wallet TEXT NOT NULL REFERENCES supervisor_profiles(wallet),
  brief_text TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_briefs_supervisor ON saved_briefs(supervisor_wallet, created_at);

CREATE TABLE IF NOT EXISTS brief_searches (
  id TEXT PRIMARY KEY,
  supervisor_wallet TEXT NOT NULL REFERENCES supervisor_profiles(wallet),
  brief_text TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  results_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brief_searches_supervisor ON brief_searches(supervisor_wallet, created_at);

CREATE TABLE IF NOT EXISTS licensing_interests (
  id TEXT PRIMARY KEY,
  supervisor_wallet TEXT NOT NULL REFERENCES supervisor_profiles(wallet),
  submission_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  status TEXT NOT NULL DEFAULT 'interested',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_interest_supermission ON licensing_interests(supervisor_wallet, submission_id);
CREATE INDEX IF NOT EXISTS idx_licensing_interests_supervisor ON licensing_interests(supervisor_wallet, created_at);

CREATE TABLE IF NOT EXISTS match_feedback (
  id TEXT PRIMARY KEY,
  supervisor_wallet TEXT NOT NULL REFERENCES supervisor_profiles(wallet),
  brief_hash TEXT NOT NULL,
  brief_text TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  catalog_source TEXT NOT NULL DEFAULT 'live' CHECK (catalog_source IN ('demo', 'live')),
  fit_score_shown REAL NOT NULL,
  rank_shown INTEGER,
  verdict TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_feedback_super_brief_sub ON match_feedback(supervisor_wallet, brief_hash, submission_id);
CREATE INDEX IF NOT EXISTS idx_match_feedback_brief_hash ON match_feedback(brief_hash);
CREATE INDEX IF NOT EXISTS idx_match_feedback_verdict_created ON match_feedback(verdict, created_at);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  supervisor_wallet TEXT NOT NULL REFERENCES supervisor_profiles(wallet),
  submission_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  brief_hash TEXT NOT NULL,
  brief_text TEXT NOT NULL,
  usage_type TEXT NOT NULL,
  territory TEXT NOT NULL DEFAULT 'worldwide',
  term_months INTEGER NOT NULL DEFAULT 12,
  fee_usdc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  payment_tx_hash TEXT,
  payment_mock BOOLEAN NOT NULL DEFAULT FALSE,
  settlement_lease_id TEXT,
  job_id TEXT,
  job_status TEXT,
  deliverable_hash TEXT,
  job_create_tx_hash TEXT,
  job_complete_tx_hash TEXT,
  settled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_license_super_sub_brief ON licenses(supervisor_wallet, submission_id, brief_hash);
CREATE INDEX IF NOT EXISTS idx_licenses_supervisor ON licenses(supervisor_wallet, created_at);

CREATE TABLE IF NOT EXISTS placement_cases (
  id TEXT PRIMARY KEY,
  supervisor_wallet TEXT NOT NULL REFERENCES supervisor_profiles(wallet),
  kind TEXT NOT NULL DEFAULT 'placement',
  brief_text TEXT NOT NULL,
  license_id TEXT REFERENCES licenses(id),
  submission_id TEXT REFERENCES submissions(id),
  status TEXT NOT NULL DEFAULT 'open',
  objective TEXT,
  pending_decision TEXT,
  agent_plan JSONB NOT NULL DEFAULT '[]',
  evidence JSONB NOT NULL DEFAULT '{}',
  last_activity TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_placement_cases_supervisor ON placement_cases(supervisor_wallet, last_activity);
CREATE UNIQUE INDEX IF NOT EXISTS uq_placement_cases_active_brief
  ON placement_cases(supervisor_wallet, brief_text)
  WHERE status NOT IN ('settled', 'archived');

CREATE TABLE IF NOT EXISTS case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES placement_cases(id),
  kind TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events(case_id, created_at);

CREATE TABLE IF NOT EXISTS release_cases (
  id TEXT PRIMARY KEY,
  artist_wallet TEXT NOT NULL REFERENCES users(wallet_address),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT,
  cover_svg TEXT,
  submission_status TEXT NOT NULL DEFAULT 'pending_payment',
  agent_plan JSONB NOT NULL DEFAULT '[]',
  last_activity TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_case_submission ON release_cases(submission_id);
CREATE INDEX IF NOT EXISTS idx_release_cases_artist ON release_cases(artist_wallet, last_activity);
`;

export async function initTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  if (_db && _pg) return _db;
  _pg = new PGlite();
  await _pg.waitReady;
  // Apply DDL — each statement runs sequentially because PGlite's exec()
  // accepts a single string with multiple statements.
  await _pg.exec(DDL);
  _db = drizzle({ client: _pg });
  return _db;
}

export function getTestDb(): ReturnType<typeof drizzle> {
  if (!_db) {
    throw new Error('getTestDb called before initTestDb');
  }
  return _db;
}

export function getTestPg(): PGlite {
  if (!_pg) throw new Error('getTestPg called before initTestDb');
  return _pg;
}

export async function resetTestDb(): Promise<void> {
  if (!_pg) return;
  // Drop all rows from every test table. Cheaper than recreating the instance.
  const tables = [
    'usage_events',
    'slot_legs',
    'slots',
    'channel_embeddings',
    'listing_embeddings',
    'channels',
    'listings',
    'case_events',
    'placement_cases',
    'release_cases',
    'licensing_interests',
    'licenses',
    'match_feedback',
    'saved_briefs',
    'brief_searches',
    'supervisor_profiles',
    'version_embeddings',
    'telemetry_events',
    'x402_proofs',
    'listen_events',
    'ar_play_events',
    'ar_playlist_tracks',
    'ar_playlists',
    'published_versions',
    'settlement_legs',
    'placement_briefs',
    'agent_reviews',
    'ratings',
    'curator_claims',
    'submissions',
    'users',
  ];
  for (const t of tables) {
    await _pg.exec(`DELETE FROM ${t};`);
  }
}

export async function closeTestDb(): Promise<void> {
  if (_pg) {
    await _pg.close();
    _pg = null;
    _db = null;
  }
}
