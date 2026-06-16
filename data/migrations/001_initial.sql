-- 001_initial.sql
-- Bootstrap table for the migration runner. Every subsequent migration is
-- tracked here. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
