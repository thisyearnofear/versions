-- MODULAR: Pre-deploy APPLY for the placement_briefs legacy-shape purge.
-- Atomic write. Use ONLY after previewing the count via
-- `npm run db:purge:preview` and confirming the affected set is legacy.
--
-- The UPDATE zeros out the four NOT NULL JSONB columns whose legacy
-- shape (object arrays for scene_tags/emotional_arcs/sync_comparables)
-- conflicts with the post-repurpose representation (string[] /
-- Array<{name, why}>). The WHERE predicate mirrors the preview —
-- only rows with a non-string-typed first element in `scene_tags` are
-- touched; safe new-shape rows (string[] / empty) are excluded.
--
-- Run AFTER scripts/rename-placement-briefs-columns.sql if the DB still
-- has legacy column names. Run BEFORE the rename if the DB has legacy
-- data in the old columns. Prod was already clean (0 rows) as of
-- 2026-07-08, so both the purge and the rename are no-ops there.
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
  scene_tags       = '[]'::jsonb,
  instruments      = '[]'::jsonb,
  emotional_arcs   = '[]'::jsonb,
  sync_comparables = '[]'::jsonb
WHERE
  jsonb_typeof(scene_tags) = 'array'
  AND jsonb_array_length(scene_tags) > 0
  AND jsonb_typeof(scene_tags->0) <> 'string';

COMMIT;
