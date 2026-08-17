CREATE TABLE "match_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"supervisor_wallet" text NOT NULL,
	"brief_hash" text NOT NULL,
	"brief_text" text NOT NULL,
	"submission_id" text NOT NULL,
	"fit_score_shown" real NOT NULL,
	"rank_shown" integer,
	"verdict" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_match_feedback_super_brief_sub" UNIQUE("supervisor_wallet","brief_hash","submission_id")
);
--> statement-breakpoint
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_supervisor_wallet_supervisor_profiles_wallet_fk" FOREIGN KEY ("supervisor_wallet") REFERENCES "public"."supervisor_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_submission_id_published_versions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_match_feedback_brief_hash" ON "match_feedback" USING btree ("brief_hash");--> statement-breakpoint
CREATE INDEX "idx_match_feedback_verdict_created" ON "match_feedback" USING btree ("verdict","created_at");