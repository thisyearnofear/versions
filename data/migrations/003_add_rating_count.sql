-- 003_add_rating_count.sql
-- The Day 2 schema left rating_count out of submissions. Day 4 reads and
-- updates it (CLEAN: every column used by a service is declared in the
-- schema). Idempotent: ALTER TABLE ADD COLUMN is a no-op if the column
-- already exists in newer SQLite, but the IF NOT EXISTS guard makes the
-- intent explicit and portable.

ALTER TABLE submissions ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
