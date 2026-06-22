-- MODULAR: A&R agent tables — playlists, tracks, and play events.
-- DRY: every A&R play goes through ar_play_events. The settlement
--      service reads from here when computing per-play payouts.
-- CLEAN: one row per play event. The listener_fee and artist_payout
--        are snapshotted at play time so rate changes don't affect
--        historical records.
--
-- ENHANCEMENT FIRST: ar_play_events reuses the settlement_legs
-- pattern from the submission flow. The ar_wallet is the payer;
-- the artist_wallet is the payee. Both legs settle through the
-- existing arc adapter.

CREATE TABLE ar_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  mood TEXT,
  ar_wallet TEXT NOT NULL,
  track_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ar_playlists_genre ON ar_playlists(genre);

CREATE TABLE ar_playlist_tracks (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES ar_playlists(id),
  version_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (playlist_id, version_id)
);

CREATE INDEX idx_ar_playlist_tracks_playlist ON ar_playlist_tracks(playlist_id, position);

-- MODULAR: ar_play_events — the economic record of each play.
-- DRY: one row per play. The listener_fee_usdc is what the listener
--      paid the A&R agent. The artist_payout_usdc is what the A&R
--      agent paid the artist. The difference is the A&R margin.
-- CLEAN: status tracks the settlement lifecycle. Both legs (listener→A&R
--        and A&R→artist) settle through the existing arc adapter.

CREATE TABLE ar_play_events (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES ar_playlists(id),
  version_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  listener_wallet TEXT NOT NULL,
  artist_wallet TEXT NOT NULL,
  listener_fee_usdc TEXT NOT NULL,
  artist_payout_usdc TEXT NOT NULL,
  listener_tx_hash TEXT,
  artist_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','settled','failed')),
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ar_play_events_playlist ON ar_play_events(playlist_id);
CREATE INDEX idx_ar_play_events_artist ON ar_play_events(artist_wallet);
CREATE INDEX idx_ar_play_events_status ON ar_play_events(status, played_at DESC);
