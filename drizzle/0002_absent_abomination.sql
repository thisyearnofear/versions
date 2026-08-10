CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"supervisor_wallet" text NOT NULL,
	"submission_id" text NOT NULL,
	"brief_hash" text NOT NULL,
	"brief_text" text NOT NULL,
	"usage_type" text NOT NULL,
	"territory" text DEFAULT 'worldwide' NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"fee_usdc" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"payment_tx_hash" text,
	"payment_mock" boolean DEFAULT false NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_license_super_sub_brief" UNIQUE("supervisor_wallet","submission_id","brief_hash")
);
--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_supervisor_wallet_supervisor_profiles_wallet_fk" FOREIGN KEY ("supervisor_wallet") REFERENCES "public"."supervisor_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_submission_id_published_versions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_licenses_supervisor" ON "licenses" USING btree ("supervisor_wallet","created_at");