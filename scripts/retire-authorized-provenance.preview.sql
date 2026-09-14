-- MODULAR: Pre-deploy PREVIEW for retiring the 'authorized' catalog
-- provenance. Read-only. No writes fire.
--
-- The marketplace pivot dropped the per-program consent machinery: there is
-- no longer a version_programs table, no program_id / authorization_status /
-- authorized_at / lineage on submissions, and catalog_source narrows from
-- ('demo', 'live', 'authorized') to ('demo', 'live'). Nothing in the product
-- can claim "pre-cleared" any more, so rows stamped 'authorized' must be
-- relabelled BEFORE `drizzle-kit push` narrows the CHECK constraints —
-- otherwise the ALTER fails against the rows that still hold the old value.
--
-- 'authorized' maps to 'live', not 'demo': those were real artist
-- submissions that went through the upload and publish pipeline. 'demo'
-- stays reserved for the seeded CC catalog.
--
-- This script rewrites DATA ONLY. The structural drops (version_programs,
-- the four submissions columns, the narrowed CHECKs) are proposed by
-- `VERSIONS_DB_APPLY=1 npm run db:prod:push`, which is interactive and
-- --strict, so an operator reviews each statement before it runs.
--
-- Run:    npm run db:retire-authorized:preview
-- Expect: the counts below. If published_versions_authorized is 0 the
--         catalog never carried pilot rows and the apply is a no-op.

SELECT
  (SELECT count(*) FROM published_versions WHERE catalog_source = 'authorized')
    AS published_versions_authorized,
  (SELECT count(*) FROM match_feedback WHERE catalog_source = 'authorized')
    AS match_feedback_authorized;

-- Supply-side footprint of the retired consent columns. Non-zero counts here
-- are expected on a database that ran the pilot; they only tell you how much
-- program data push is about to drop, not whether the rewrite is safe.
SELECT
  (SELECT count(*) FROM submissions WHERE program_id IS NOT NULL)
    AS submissions_with_program,
  (SELECT count(*) FROM submissions WHERE authorization_status IS NOT NULL)
    AS submissions_with_auth_status,
  (SELECT count(*) FROM submissions WHERE lineage IS NOT NULL)
    AS submissions_with_lineage;

-- Guard: the rewrite is only meaningful if the pilot tables still exist. On a
-- database where push already ran, these report 'absent' and the apply is a
-- no-op rather than an error.
SELECT
  to_regclass('public.version_programs') IS NOT NULL AS version_programs_present,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'submissions' AND column_name = 'program_id') = 1
    AS submissions_program_id_present;

-- Sample of the rows that will be relabelled, so the operator can eyeball
-- that these are real published takes rather than seeded demo data.
SELECT submission_id, title, artist_name, catalog_source, published_at
FROM published_versions
WHERE catalog_source = 'authorized'
ORDER BY published_at DESC
LIMIT 20;
