CREATE TABLE "case_events" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"supervisor_wallet" text NOT NULL,
	"kind" text DEFAULT 'placement' NOT NULL,
	"brief_text" text NOT NULL,
	"license_id" text,
	"submission_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"objective" text,
	"pending_decision" text,
	"agent_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_activity" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_placement_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."placement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_cases" ADD CONSTRAINT "placement_cases_supervisor_wallet_supervisor_profiles_wallet_fk" FOREIGN KEY ("supervisor_wallet") REFERENCES "public"."supervisor_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_cases" ADD CONSTRAINT "placement_cases_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_cases" ADD CONSTRAINT "placement_cases_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_case_events_case" ON "case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_placement_cases_supervisor" ON "placement_cases" USING btree ("supervisor_wallet","last_activity");