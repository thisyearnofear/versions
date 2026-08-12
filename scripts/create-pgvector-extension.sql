-- ─────────────────────────────────────────────────────────────
-- Enable the pgvector extension for CLAP semantic search.
--
-- Run this BEFORE `npm run db:push` on any DB that doesn't yet
-- have the extension. On Neon, pgvector is available on all plans.
--
-- NOTE: this script ONLY enables the extension. The
-- version_embeddings table + ivfflat index are owned by the Drizzle
-- schema. Production currently has no __drizzle_migrations ledger,
-- so never run `db:migrate` there: follow docs/deploy.md and use the
-- guarded db:prod status → backup → push procedure instead.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;
