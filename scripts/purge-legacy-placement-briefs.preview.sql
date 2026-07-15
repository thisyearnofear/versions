-- MODULAR: Pre-deploy PREVIEW for the placement_briefs legacy-shape purge.
-- Read-only. No writes fire.
--
-- The placement_briefs columns (scene_tags / instruments / emotional_arcs /
-- sync_comparables) assert the JSON shape is `string[]` (or
-- `Array<{name, why}>` for sync_comparables). Legacy rows predate the
-- repurpose and may hold object arrays. Drizzle won't crash but
-- downstream `.map()` over object arrays will.
--
-- The filter uses `scene_tags` as the proxy marker because legacy
-- scene_tags (formerly `venues`) was the venue-contact object array
-- (`{name, location, capacity}`). A row with
-- `jsonb_typeof(scene_tags->0) <> 'string'` reliably identifies
-- pre-repurpose rows even if other columns happen to look stringy.
--
-- Run:    npm run db:purge:preview
-- Expect: a count of rows whose scene_tags column has at least one
--         non-string-typed element. Large counts (> ~50) signal that
--         the legacy data is real and the wipe is warranted.
--
-- After the preview, run `npm run db:purge:apply` (BEGIN/COMMIT around
-- the UPDATE) only if the count matches what you expect.

SELECT
  count(*) AS legacy_rows_to_purge,
  count(DISTINCT submission_id) AS distinct_submissions_impacted
FROM placement_briefs
WHERE
  jsonb_typeof(scene_tags) = 'array'
  AND jsonb_array_length(scene_tags) > 0
  AND jsonb_typeof(scene_tags->0) <> 'string';

SELECT
  id,
  submission_id,
  audience_summary,
  jsonb_typeof(scene_tags) AS scene_tags_type,
  jsonb_typeof(instruments) AS instruments_type,
  jsonb_typeof(emotional_arcs) AS emotional_arcs_type,
  jsonb_typeof(sync_comparables) AS sync_comparables_type
FROM placement_briefs
WHERE
  jsonb_typeof(scene_tags) = 'array'
  AND jsonb_array_length(scene_tags) > 0
  AND jsonb_typeof(scene_tags->0) <> 'string'
ORDER BY created_at
LIMIT 20;
