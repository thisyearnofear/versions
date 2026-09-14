-- MODULAR: APPLY for retiring the 'authorized' catalog provenance.
-- Run the preview first and confirm the counts match what you expect:
--
--   npm run db:retire-authorized:preview
--   npm run db:retire-authorized:apply
--
-- Rewrites DATA ONLY, inside one transaction. Idempotent: the WHERE clause
-- matches nothing once the rows are relabelled, so a second run is a no-op.
-- Safe to run either side of `db:prod:push` — before, it unblocks the CHECK
-- narrowing; after, it finds zero rows.
--
-- 'authorized' becomes 'live', never 'demo'. Those were real artist
-- submissions that cleared the upload and publish pipeline; 'demo' stays
-- reserved for the seeded CC catalog. Relabelling them as demo would hide
-- genuine supply from the marketplace and misreport catalog provenance.
--
-- The structural drops (version_programs, submissions.program_id /
-- authorization_status / authorized_at / lineage, the narrowed CHECKs) are
-- deliberately NOT here. They belong to the interactive, --strict
-- `db:prod:push` so an operator reviews each destructive statement.

BEGIN;

UPDATE published_versions
SET catalog_source = 'live'
WHERE catalog_source = 'authorized';

UPDATE match_feedback
SET catalog_source = 'live'
WHERE catalog_source = 'authorized';

COMMIT;

-- Post-condition: nothing may still hold the retired value. Both counts must
-- be 0 or the CHECK narrowing in the following push will fail.
SELECT
  (SELECT count(*) FROM published_versions WHERE catalog_source = 'authorized')
    AS published_versions_still_authorized,
  (SELECT count(*) FROM match_feedback WHERE catalog_source = 'authorized')
    AS match_feedback_still_authorized;
