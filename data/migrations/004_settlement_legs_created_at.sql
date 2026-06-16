-- MODULAR: add created_at to settlement_legs. The reconciliation
-- sweeper (Phase 2) needs to know how long a leg has been pending
-- so it can retry stuck ones. CLEAN: every leg now has a full
-- audit trail (created_at, settled_at, tx_hash).

ALTER TABLE settlement_legs ADD COLUMN created_at TEXT;

-- PERFORMANT: default existing rows to their submission's
-- published_at. New rows get the current timestamp.
UPDATE settlement_legs
   SET created_at = COALESCE(
     (SELECT published_at FROM submissions WHERE submissions.id = settlement_legs.submission_id),
     datetime('now')
   );

-- CLEAN: enforce a non-null created_at on new rows. Existing
-- rows are already backfilled above.
CREATE TABLE settlement_legs_new (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  recipient_wallet TEXT NOT NULL,
  recipient_role TEXT NOT NULL
    CHECK (recipient_role IN ('curator','platform','musicbrainz')),
  amount_usdc TEXT NOT NULL,
  tx_hash TEXT,
  settled_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','settled','failed')),
  created_at TEXT NOT NULL
);
INSERT INTO settlement_legs_new
  SELECT id, submission_id, recipient_wallet, recipient_role, amount_usdc,
         tx_hash, settled_at, status, created_at
    FROM settlement_legs;
DROP TABLE settlement_legs;
ALTER TABLE settlement_legs_new RENAME TO settlement_legs;
CREATE INDEX idx_settlement_submission ON settlement_legs(submission_id);
CREATE INDEX idx_settlement_status_created ON settlement_legs(status, created_at);
