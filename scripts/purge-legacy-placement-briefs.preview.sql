-- MODULAR: Pre-deploy PREVIEW for the placement_briefs column-aliasing
-- migration (commit 6f48d190). Read-only. No writes fire.
--
-- The Drizzle column-aliasing in src/lib/schema.ts rebinds the legacy
-- NOT NULL JSONB columns `venues / youtube_channels / influencers /
-- draft_emails` to NEW logical fields (sceneTags / instruments /
-- emotionalArcs / syncComparables) and asserts the JSON shape is
-- `string[]` (or `Array<{name, why}>` for syncComparables). Legacy rows
-- predate that mapping and may hold object arrays in `venues /
-- influencers / draft_emails`. Drizzle won't crash but downstream
-- `.map()` over object arrays will.
--
-- The filter uses `venues` as the proxy marker because legacy `venues`
-- was the venue-contact object array (`{name, location, capacity}`).
-- A row with `jsonb_typeof(venues->0) <> 'string'` reliably identifies
-- pre-repurpose rows even if other columns happen to look stringy.
--
-- Run:    npm run db:purge:preview
-- Expect: a count of rows whose venues column has at least one
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
  jsonb_typeof(venues) = 'array'
  AND jsonb_array_length(venues) > 0
  AND jsonb_typeof(venues->0) <> 'string';

SELECT
  id,
  submission_id,
  audience_summary,
  jsonb_typeof(venues) AS venues_type,
  jsonb_typeof(youtube_channels) AS youtube_type,
  jsonb_typeof(influencers) AS influencers_type,
  jsonb_typeof(draft_emails) AS draft_type
FROM placement_briefs
WHERE
  jsonb_typeof(venues) = 'array'
  AND jsonb_array_length(venues) > 0
  AND jsonb_typeof(venues->0) <> 'string'
ORDER BY created_at
LIMIT 20;
