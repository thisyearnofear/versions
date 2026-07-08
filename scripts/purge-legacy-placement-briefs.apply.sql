-- MODULAR: Pre-deploy APPLY for the placement_briefs column-aliasing
-- migration (commit 6f48d190). Atomic write. Use ONLY after previewing
-- the count via `npm run db:purge:preview` and confirming the affected
-- set is genuinely legacy.
--
-- The UPDATE zeros out the four NOT NULL JSONB columns whose legacy
-- shape (object arrays for venues/influencers/draft_emails) conflicts
-- with the post-repurpose Drizzle column-aliasing (string[] /
-- Array<{name, why}>). The WHERE predicate mirrors the preview —
-- only rows with a non-string-typed first element in `venues` are
-- touched; safe new-shape rows (string[] / empty) are excluded.
--
-- Run:    npm run db:purge:apply
-- Revert: any `UPDATE` can be re-read by the same SELECT — but there
--         is no automatic rollback. Take a snapshot before applying:
--         `pg_dump --table=placement_briefs "$DATABASE_URL" > brief.bak`
--
-- audience_summary is INTENTIONALLY not in the SET clause — the
-- TEXT column kept its semantics across the repurpose and any
-- existing copy is still useful for the supervisor inverse-search.

BEGIN;

UPDATE placement_briefs
SET
  venues          = '[]'::jsonb,
  youtube_channels = '[]'::jsonb,
  influencers     = '[]'::jsonb,
  draft_emails    = '[]'::jsonb
WHERE
  jsonb_typeof(venues) = 'array'
  AND jsonb_array_length(venues) > 0
  AND jsonb_typeof(venues->0) <> 'string';

COMMIT;
