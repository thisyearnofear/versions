-- MODULAR: listen_events — agent/listener-driven payment leg table.
-- DRY: every per-listen settlement goes through this table; settlement.js
--      reads settled legs from here when computing dashboard aggregates.
-- CLEAN: one row per listen. The "stream_id" is opaque so a future server-
--        side metering scheme can replace per-second polling without a
--        schema migration.
--
-- Why now (Day 1): the agent-discovery service (Day 3) and the listen
-- route (Day 2) both write here. Adding the table on Day 1 means the
-- existing 54 tests can run with the new schema in place — no Day-2
-- migration surprise.

CREATE TABLE listen_events (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  listener_wallet TEXT NOT NULL,            -- who listened; the agent's hot wallet
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,                            -- null while the stream is in flight
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  rate_per_second_usdc TEXT NOT NULL,       -- snapshot of the agent's bid at start
  amount_usdc TEXT NOT NULL,                -- duration_seconds * rate; recomputed on end
  status TEXT NOT NULL DEFAULT 'in_flight'
    CHECK (status IN ('in_flight','settled','failed','cancelled')),
  settlement_leg_id TEXT REFERENCES settlement_legs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_listen_events_version ON listen_events(version_id);
CREATE INDEX idx_listen_events_listener ON listen_events(listener_wallet);
CREATE INDEX idx_listen_events_status ON listen_events(status, started_at DESC);
