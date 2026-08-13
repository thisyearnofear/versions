-- The old select-then-insert open path could have produced duplicate active
-- cases. Retain the most recently active one, archive the rest deterministically,
-- then install the constraint that prevents recurrence.
WITH ranked_active_cases AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY supervisor_wallet, brief_text
      ORDER BY last_activity DESC, created_at DESC, id DESC
    ) AS position
  FROM placement_cases
  WHERE status NOT IN ('settled', 'archived')
)
UPDATE placement_cases AS placement_case
SET
  status = 'archived',
  objective = COALESCE(objective, 'superseded duplicate active case'),
  updated_at = now()
FROM ranked_active_cases
WHERE placement_case.id = ranked_active_cases.id
  AND ranked_active_cases.position > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_placement_cases_active_brief" ON "placement_cases" USING btree ("supervisor_wallet","brief_text") WHERE "placement_cases"."status" NOT IN ('settled', 'archived');