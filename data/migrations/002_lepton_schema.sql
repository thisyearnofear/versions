-- 002_lepton_schema.sql
-- Lepton Submission Marketplace schema. Five tables, no vector search, no
-- file storage tables (uploads live on the filesystem under data/uploads/).

-- submissions: a version uploaded by an artist awaiting curation.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  artist_wallet TEXT NOT NULL,
  audius_track_id TEXT,
  musicbrainz_id TEXT,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT NOT NULL CHECK (version_type IN
    ('demo','live','acoustic','remix','remaster','studio','other')),
  genre TEXT,
  artist_mood TEXT,
  description TEXT,
  audio_path TEXT NOT NULL,
  audio_duration_seconds INTEGER,
  audio_size_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  fee_quote_usdc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','awaiting_curation','in_curation',
                      'published','rejected')),
  payment_tx_hash TEXT,
  payment_verified_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX idx_submissions_status ON submissions(status, submitted_at DESC);
CREATE INDEX idx_submissions_artist ON submissions(artist_wallet);

-- curator_claims: a curator locks a submission to rate it.
CREATE TABLE curator_claims (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  curator_wallet TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE (submission_id, curator_wallet)
);
CREATE INDEX idx_claims_submission ON curator_claims(submission_id);

-- ratings: structured subjective metadata, one per curator per submission.
CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  curator_wallet TEXT NOT NULL,
  solo_intensity INTEGER NOT NULL CHECK (solo_intensity BETWEEN 1 AND 10),
  vocal_quality INTEGER NOT NULL CHECK (vocal_quality BETWEEN 1 AND 10),
  energy_vs_studio TEXT NOT NULL
    CHECK (energy_vs_studio IN ('lower','same','higher')),
  tempo_feel TEXT NOT NULL
    CHECK (tempo_feel IN ('dragging','locked','rushing')),
  mood_tags TEXT NOT NULL,    -- JSON array of strings
  notes TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (submission_id, curator_wallet)
);
CREATE INDEX idx_ratings_submission ON ratings(submission_id);

-- settlement_legs: per-leg USDC payouts (one row per recipient).
CREATE TABLE settlement_legs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  recipient_wallet TEXT NOT NULL,
  recipient_role TEXT NOT NULL
    CHECK (recipient_role IN ('curator','platform','musicbrainz')),
  amount_usdc TEXT NOT NULL,
  tx_hash TEXT,
  settled_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','settled','failed'))
);
CREATE INDEX idx_settlement_submission ON settlement_legs(submission_id);
CREATE INDEX idx_settlement_status ON settlement_legs(status);

-- published_versions: denormalised feed rows, populated by the publish gate.
CREATE TABLE published_versions (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  artist_wallet TEXT NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  musicbrainz_id TEXT,
  avg_solo_intensity REAL,
  avg_vocal_quality REAL,
  energy_consensus TEXT,
  tempo_consensus TEXT,
  aggregated_mood_tags TEXT,    -- JSON array
  rating_count INTEGER NOT NULL,
  published_at TEXT NOT NULL
);
CREATE INDEX idx_published_at ON published_versions(published_at DESC);
