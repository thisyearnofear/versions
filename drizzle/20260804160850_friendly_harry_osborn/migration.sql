CREATE TABLE "agent_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"curator_wallet" text NOT NULL,
	"solo_intensity" integer NOT NULL,
	"vocal_quality" integer NOT NULL,
	"energy_vs_studio" text NOT NULL,
	"tempo_feel" text NOT NULL,
	"mood_tags" jsonb NOT NULL,
	"notes" text,
	"raw_response" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_review" UNIQUE("submission_id","agent_name")
);
--> statement-breakpoint
CREATE TABLE "ar_play_events" (
	"id" text PRIMARY KEY NOT NULL,
	"playlist_id" text NOT NULL,
	"version_id" text NOT NULL,
	"listener_wallet" text NOT NULL,
	"artist_wallet" text NOT NULL,
	"listener_fee_usdc" text NOT NULL,
	"artist_payout_usdc" text NOT NULL,
	"listener_tx_hash" text,
	"artist_tx_hash" text,
	"play_type" text DEFAULT 'paid' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"played_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ar_playlist_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"playlist_id" text NOT NULL,
	"version_id" text NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_playlist_track" UNIQUE("playlist_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "ar_playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"genre" text,
	"mood" text,
	"reasoning" text,
	"ar_wallet" text NOT NULL,
	"track_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brief_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"supervisor_wallet" text NOT NULL,
	"brief_text" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"curator_wallet" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"released_at" timestamp,
	CONSTRAINT "uq_claim_submission_curator" UNIQUE("submission_id","curator_wallet")
);
--> statement-breakpoint
CREATE TABLE "licensing_interests" (
	"id" text PRIMARY KEY NOT NULL,
	"supervisor_wallet" text NOT NULL,
	"submission_id" text NOT NULL,
	"status" text DEFAULT 'interested' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_interest_supermission" UNIQUE("supervisor_wallet","submission_id")
);
--> statement-breakpoint
CREATE TABLE "listen_events" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"listener_wallet" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"rate_per_second_usdc" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"status" text DEFAULT 'in_flight' NOT NULL,
	"settlement_leg_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listener_badges" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"badge_type" text NOT NULL,
	"awarded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listener_profiles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"reputation_score" integer DEFAULT 0 NOT NULL,
	"free_plays_used_today" integer DEFAULT 0 NOT NULL,
	"free_plays_daily_limit" integer DEFAULT 10 NOT NULL,
	"last_free_play_reset" timestamp DEFAULT now() NOT NULL,
	"total_plays" integer DEFAULT 0 NOT NULL,
	"total_paid_plays" integer DEFAULT 0 NOT NULL,
	"total_free_plays" integer DEFAULT 0 NOT NULL,
	"distinct_tracks_played" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"agent_name" text DEFAULT 'market' NOT NULL,
	"scene_tags" jsonb NOT NULL,
	"instruments" jsonb NOT NULL,
	"emotional_arcs" jsonb NOT NULL,
	"sync_comparables" jsonb NOT NULL,
	"audience_summary" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "placement_briefs_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "published_versions" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"artist_wallet" text NOT NULL,
	"title" text NOT NULL,
	"artist_name" text NOT NULL,
	"version_type" text NOT NULL,
	"audio_path" text NOT NULL,
	"musicbrainz_id" text,
	"cover_svg" text,
	"avg_solo_intensity" real,
	"avg_vocal_quality" real,
	"energy_consensus" text,
	"tempo_consensus" text,
	"aggregated_mood_tags" jsonb,
	"rating_count" integer NOT NULL,
	"published_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"curator_wallet" text NOT NULL,
	"solo_intensity" integer NOT NULL,
	"vocal_quality" integer NOT NULL,
	"energy_vs_studio" text NOT NULL,
	"tempo_feel" text NOT NULL,
	"mood_tags" jsonb NOT NULL,
	"notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rating_submission_curator" UNIQUE("submission_id","curator_wallet")
);
--> statement-breakpoint
CREATE TABLE "saved_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"supervisor_wallet" text NOT NULL,
	"brief_text" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"recipient_wallet" text NOT NULL,
	"recipient_role" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"tx_hash" text,
	"settled_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_legs_submission_wallet_role" UNIQUE("submission_id","recipient_wallet","recipient_role")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_wallet" text NOT NULL,
	"audius_track_id" text,
	"musicbrainz_id" text,
	"title" text NOT NULL,
	"artist_name" text NOT NULL,
	"version_type" text NOT NULL,
	"genre" text,
	"artist_mood" text,
	"description" text,
	"audio_path" text NOT NULL,
	"audio_duration_seconds" integer,
	"audio_size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"audio_sha256" text,
	"fee_quote_usdc" text NOT NULL,
	"cover_svg" text,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"payment_tx_hash" text,
	"payment_verified_at" timestamp,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "uq_audio_sha256_wallet" UNIQUE("audio_sha256","artist_wallet")
);
--> statement-breakpoint
CREATE TABLE "supervisor_profiles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"company" text,
	"role" text DEFAULT 'supervisor',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session" text NOT NULL,
	"event" text NOT NULL,
	"path" text,
	"referrer" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_ts" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"email" text,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "version_embeddings" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"embedding" vector(512) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"puid" text NOT NULL,
	"resource_url" text NOT NULL,
	"scheme" text NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"pay_to" text NOT NULL,
	"amount_micro_usdc" text NOT NULL,
	"valid_until" timestamp NOT NULL,
	"tipper_wallet" text NOT NULL,
	"artist_wallet" text NOT NULL,
	"message" text,
	"signature" text NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'verified' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	CONSTRAINT "x402_proofs_puid_unique" UNIQUE("puid")
);
--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_play_events" ADD CONSTRAINT "ar_play_events_playlist_id_ar_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."ar_playlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_play_events" ADD CONSTRAINT "ar_play_events_version_id_published_versions_submission_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_playlist_tracks" ADD CONSTRAINT "ar_playlist_tracks_playlist_id_ar_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."ar_playlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_playlist_tracks" ADD CONSTRAINT "ar_playlist_tracks_version_id_published_versions_submission_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_searches" ADD CONSTRAINT "brief_searches_supervisor_wallet_supervisor_profiles_wallet_fk" FOREIGN KEY ("supervisor_wallet") REFERENCES "public"."supervisor_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_claims" ADD CONSTRAINT "curator_claims_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licensing_interests" ADD CONSTRAINT "licensing_interests_supervisor_wallet_supervisor_profiles_wallet_fk" FOREIGN KEY ("supervisor_wallet") REFERENCES "public"."supervisor_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licensing_interests" ADD CONSTRAINT "licensing_interests_submission_id_published_versions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_events" ADD CONSTRAINT "listen_events_version_id_published_versions_submission_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_events" ADD CONSTRAINT "listen_events_settlement_leg_id_settlement_legs_id_fk" FOREIGN KEY ("settlement_leg_id") REFERENCES "public"."settlement_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listener_badges" ADD CONSTRAINT "listener_badges_wallet_listener_profiles_wallet_fk" FOREIGN KEY ("wallet") REFERENCES "public"."listener_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_briefs" ADD CONSTRAINT "placement_briefs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_versions" ADD CONSTRAINT "published_versions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_briefs" ADD CONSTRAINT "saved_briefs_supervisor_wallet_supervisor_profiles_wallet_fk" FOREIGN KEY ("supervisor_wallet") REFERENCES "public"."supervisor_profiles"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_legs" ADD CONSTRAINT "settlement_legs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_artist_wallet_users_wallet_address_fk" FOREIGN KEY ("artist_wallet") REFERENCES "public"."users"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_profiles" ADD CONSTRAINT "supervisor_profiles_wallet_users_wallet_address_fk" FOREIGN KEY ("wallet") REFERENCES "public"."users"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_embeddings" ADD CONSTRAINT "version_embeddings_submission_id_published_versions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."published_versions"("submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_reviews_submission" ON "agent_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_ar_play_events_playlist" ON "ar_play_events" USING btree ("playlist_id");--> statement-breakpoint
CREATE INDEX "idx_ar_play_events_artist" ON "ar_play_events" USING btree ("artist_wallet");--> statement-breakpoint
CREATE INDEX "idx_ar_play_events_status" ON "ar_play_events" USING btree ("status","played_at");--> statement-breakpoint
CREATE INDEX "idx_ar_playlist_tracks_playlist" ON "ar_playlist_tracks" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "idx_ar_playlists_genre" ON "ar_playlists" USING btree ("genre");--> statement-breakpoint
CREATE INDEX "idx_brief_searches_supervisor" ON "brief_searches" USING btree ("supervisor_wallet","created_at");--> statement-breakpoint
CREATE INDEX "idx_claims_submission" ON "curator_claims" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_licensing_interests_supervisor" ON "licensing_interests" USING btree ("supervisor_wallet","created_at");--> statement-breakpoint
CREATE INDEX "idx_listen_events_version" ON "listen_events" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_listen_events_listener" ON "listen_events" USING btree ("listener_wallet");--> statement-breakpoint
CREATE INDEX "idx_listen_events_status" ON "listen_events" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "idx_listener_badges_wallet" ON "listener_badges" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "idx_listener_profiles_reputation" ON "listener_profiles" USING btree ("reputation_score");--> statement-breakpoint
CREATE INDEX "idx_placement_briefs_submission" ON "placement_briefs" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_published_at" ON "published_versions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_ratings_submission" ON "ratings" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_saved_briefs_supervisor" ON "saved_briefs" USING btree ("supervisor_wallet","created_at");--> statement-breakpoint
CREATE INDEX "idx_settlement_submission" ON "settlement_legs" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_settlement_recipient" ON "settlement_legs" USING btree ("recipient_wallet");--> statement-breakpoint
CREATE INDEX "idx_submissions_status" ON "submissions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "idx_submissions_artist" ON "submissions" USING btree ("artist_wallet");--> statement-breakpoint
CREATE INDEX "idx_supervisor_profiles_email" ON "supervisor_profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_telemetry_session" ON "telemetry_events" USING btree ("session","created_at");--> statement-breakpoint
CREATE INDEX "idx_telemetry_event" ON "telemetry_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "idx_x402_proofs_tipper" ON "x402_proofs" USING btree ("tipper_wallet");--> statement-breakpoint
CREATE INDEX "idx_x402_proofs_artist" ON "x402_proofs" USING btree ("artist_wallet");--> statement-breakpoint
CREATE INDEX "idx_x402_proofs_status" ON "x402_proofs" USING btree ("status","created_at");