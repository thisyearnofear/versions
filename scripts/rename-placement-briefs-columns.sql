-- ─────────────────────────────────────────────────────────────
-- Rename placement_briefs columns to match their logical names.
--
-- The repurpose commit (6f48d190) bound the existing NOT NULL JSONB
-- columns to new logical field names via Drizzle column-aliasing:
--   venues          → sceneTags       (jsonb<string[]>)
--   youtube_channels → instruments    (jsonb<string[]>)
--   influencers     → emotionalArcs   (jsonb<string[]>)
--   draft_emails    → syncComparables (jsonb<{name, why}[]>)
--
-- This script renames the physical columns so the DB matches the
-- logical names — no more aliasing, no more semantic lie at the
-- schema level. Drizzle's schema.ts is updated in the same change
-- to use the real column names.
--
-- PREREQUISITE: run the legacy purge first if the DB has pre-repurpose
-- rows with object-array shapes. The purge zeroed those to '[]'::jsonb
-- so the rename carries clean string[] / {name, why}[] data forward.
-- Prod was already clean (0 rows) as of 2026-07-08.
--
-- Idempotent: ALTER TABLE … RENAME COLUMN fails if the old column
-- doesn't exist, so re-running after success will error on the first
-- statement. Wrap in a transaction so a partial rename rolls back.
-- ─────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE placement_briefs RENAME COLUMN venues TO scene_tags;
ALTER TABLE placement_briefs RENAME COLUMN youtube_channels TO instruments;
ALTER TABLE placement_briefs RENAME COLUMN influencers TO emotional_arcs;
ALTER TABLE placement_briefs RENAME COLUMN draft_emails TO sync_comparables;

COMMIT;
