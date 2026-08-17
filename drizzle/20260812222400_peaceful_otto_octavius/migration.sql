CREATE TABLE "release_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_wallet" text NOT NULL,
	"submission_id" text NOT NULL,
	"title" text NOT NULL,
	"artist_name" text NOT NULL,
	"version_type" text,
	"cover_svg" text,
	"submission_status" text DEFAULT 'pending_payment' NOT NULL,
	"agent_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_activity" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_release_case_submission" UNIQUE("submission_id")
);
--> statement-breakpoint
ALTER TABLE "release_cases" ADD CONSTRAINT "release_cases_artist_wallet_users_wallet_address_fk" FOREIGN KEY ("artist_wallet") REFERENCES "public"."users"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_cases" ADD CONSTRAINT "release_cases_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_release_cases_artist" ON "release_cases" USING btree ("artist_wallet","last_activity");