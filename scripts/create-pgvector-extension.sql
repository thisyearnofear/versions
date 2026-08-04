-- ─────────────────────────────────────────────────────────────
-- Enable the pgvector extension for CLAP semantic search.
--
-- Run this BEFORE `npm run db:migrate` (or `npm run db:push`) on
-- any DB that doesn't yet have the extension. On Neon, pgvector
-- is available on all plans.
--
-- NOTE: this script ONLY enables the extension. The
-- version_embeddings table + ivfflat index are owned by the Drizzle
-- migration (drizzle/0000_*.sql) so there is no double-create
-- between db:pgvector and db:migrate. If you are still on the old
-- db:push workflow and a table exists from a pre-migration run,
-- the migration's CREATE TABLE will skip-apply cleanly on a fresh
-- DB or you can drop the table first on a drifted one.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;
