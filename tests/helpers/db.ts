// MODULAR: PGlite-backed test DB fixture.
// One in-memory Postgres per test file; schema is applied from src/lib/schema
// via a hand-rolled DDL (drizzle-kit is overkill for tests). Services import
// the singleton via `@/lib/db`, so we use vi.mock to inject this db.

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/lib/schema';

let _pg: PGlite | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

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
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_review ON agent_reviews(submission_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_submission ON agent_reviews(submission_id);

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
  published_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_at ON published_versions(published_at);

CREATE TABLE IF NOT EXISTS ar_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  mood TEXT,
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
`;

export async function initTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  if (_db && _pg) return _db;
  _pg = new PGlite();
  await _pg.waitReady;
  // Apply DDL — each statement runs sequentially because PGlite's exec()
  // accepts a single string with multiple statements.
  await _pg.exec(DDL);
  _db = drizzle(_pg, { schema }) as ReturnType<typeof drizzle<typeof schema>>;
  return _db;
}

export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
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
    'licensing_interests',
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
