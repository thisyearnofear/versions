ALTER TABLE "licenses" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "job_status" text;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "deliverable_hash" text;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "job_create_tx_hash" text;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "job_complete_tx_hash" text;--> statement-breakpoint
ALTER TABLE "match_feedback" ADD COLUMN "catalog_source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "published_versions" ADD COLUMN "catalog_source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
UPDATE "published_versions" SET "catalog_source" = 'demo' WHERE "submission_id" LIKE 'demo-%';--> statement-breakpoint
UPDATE "match_feedback" AS mf
SET "catalog_source" = pv."catalog_source"
FROM "published_versions" AS pv
WHERE mf."submission_id" = pv."submission_id";