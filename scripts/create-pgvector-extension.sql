-- ─────────────────────────────────────────────────────────────
-- Enable the pgvector extension and create the version_embeddings
-- table with a vector(512) column for CLAP semantic search.
--
-- Run this BEFORE `npm run db:push` on any DB that doesn't yet have
-- the extension. On Neon, pgvector is available on all plans.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS + CREATE TABLE IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS version_embeddings (
  submission_id TEXT PRIMARY KEY REFERENCES published_versions(submission_id),
  embedding vector(512) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- MODULAR: ivfflat index for fast approximate nearest-neighbor search.
-- lists=100 is a reasonable default for ≤ 100k rows; tune up for larger
-- catalogs. The index must be created AFTER the extension is enabled.
CREATE INDEX IF NOT EXISTS idx_version_embeddings_vector
  ON version_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
