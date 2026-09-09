import type { LicenseUsageType } from './pricing';

export type VersionType = 'demo' | 'live' | 'acoustic' | 'remix' | 'remaster' | 'studio' | 'other';
export type Energy = 'lower' | 'same' | 'higher';
export type Tempo = 'dragging' | 'locked' | 'rushing';
export type Valence = 'bright' | 'neutral' | 'dark';
export type SubmissionStatus = 'pending_payment' | 'awaiting_curation' | 'in_curation' | 'published' | 'rejected';
export type SettlementStatus = 'pending' | 'settled' | 'failed';
export type AgentName = 'production' | 'performance' | 'market';
export type RecipientRole = 'curator' | 'platform' | 'musicbrainz' | 'supplier' | 'channel';

// Catalog provenance describes where a listing came from. It is intentionally
// separate from kind, ranking quality, and rights clearance. 'demo' = seeded
// illustrative rows (never served for money); 'live' = a real supplier listing.
// The old 'authorized' source (artist-authorized version programs) was removed
// in the marketplace pivot — there are no per-program consent records anymore.
export type CatalogSource = 'demo' | 'live';
export type CatalogMode = 'guided_demo' | 'live_catalog' | 'mixed';
export interface CatalogProvenance {
  source: CatalogSource;
  label: 'Guided demo' | 'Live catalog';
  description: string;
}

// MODULAR: the `mood_tags` envelope shape. The DB-side jsonb column
// stores `string[]`, but Drizzle's round-trip hands back either a
// real JS array OR a JSON-stringified envelope depending on
// serialization context. The four-arm union captures both,
// plus the explicit unset types (null/undefined). Consumers MUST
// pipe it through `parseMoodTags(raw)` in `@/lib/format` before
// reading as `string[]`.
//
// This is the canonical definition; `@/lib/api-client` re-exports
// it for backward compatibility.
export type MoodTagsEnvelope = string | string[] | null | undefined;

export interface TasteGraphRating {
  soloIntensity: number;
  vocalQuality: number;
  energyVsStudio: Energy;
  tempoFeel: Tempo;
  moodTags: string[];
  notes?: string;
}

// MODULAR: supervisor-facing inverse-search index. The market agent
// emits these as a track's searchable profile; a supervisor's brief
// is embedded and matched against the union of scene_tags, instruments,
// emotional_arcs, and sync_comparables on the published catalog.
export interface PlacementBrief {
  scene_tags: string[];
  instruments: string[];
  emotional_arcs: string[];
  sync_comparables: Array<{ name: string; why: string }>;
  audience_summary: string;
}

export interface AgentReview extends TasteGraphRating {
  agentName: AgentName;
  placementBrief?: PlacementBrief;
}

// MODULAR: per-agent differentiated verdict detail. Every agent grades on a
// distinct expert headline metric so the three reviews read as three lenses
// rather than one model asked three times. `fit_score` is that agent's 1-10
// sync-fit read. Lives here (not in the LLM adapter or schema) because both
// the adapter that emits it and the adapter-agnostic persistence/UI layers
// must agree on the shape without coupling schema to a provider.
export interface AgentDetail {
  fit_score: number; // 1-10 sync-fit as judged by this agent
  metric: number; // 0-10 headline metric for this agent's focus
  metric_label: string; // e.g. "mix clarity" | "vocal delivery" | "placement recall"
  note: string; // one-line expert take
}

export interface SettlementLeg {
  id: string;
  submissionId: string;
  recipientWallet: string;
  recipientRole: RecipientRole;
  amountUsdc: string;
  txHash?: string;
  status: SettlementStatus;
}

// ── Brief → Match inverse-search types ────────────────
// MODULAR: the supervisor-facing inverse-search index. The
// searchByBrief service takes a free-text brief + structured
// filters, scores every published version against the union of
// (scene_tags, instruments, emotional_arcs, audience_summary)
// on placement_briefs, and returns ranked rows with plain-language
// `why_fits` citations. v1 is structured-tag only; v2 adds CLAP
// semantic audio similarity via pgvector (hybrid scorer: semantic
// similarity is the primary signal, structured tags provide the
// `why_fits` citations). See src/services/feed.ts.
export interface BriefSearchLicenseAvailability {
  // Demo tracks are intentionally preview-only; live tracks can enter the
  // authenticated workflow. The old 'cleared' state (per-version consent
  // records) was removed in the marketplace pivot — there is no per-track
  // clearance anymore, only a blanket ToS for free use.
  status: 'demo_preview' | 'requestable';
  reason: string;
  clearance: {
    status: 'unverified';
    reason: string;
  };
}

export interface BriefSearchLicenseQuote {
  // Demo schedule values are illustrative samples. Live values remain
  // indicative until rights-aware final quoting exists.
  status: 'sample' | 'indicative';
  territory: 'worldwide';
  term_months: 12;
  usage_options: Array<{
    usage_type: LicenseUsageType;
    fee_usdc: string;
  }>;
}

// A result-level decision aid, not a simulated clearance record. It makes
// the specific evidence still required for a final license explicit so a
// supervisor can distinguish a requestable workflow from a cleared outcome.
export interface BriefSearchLicensingEvidence {
  status: 'sample_only' | 'rights_review_required';
  summary: string;
  outstanding: Array<{
    requirement: 'rights_authority' | 'scope_and_restrictions' | 'final_quote';
    description: string;
  }>;
}

// ── Marketplace (dual-vertical placement) types ─────────
// MODULAR: the pivot. VERSIONS is a marketplace where AI-run distribution
// channels browse a feed of music + product placements, pick what fits their
// content's ethos, and use it — free (attribution required) or paid (flat fee
// / CPM, "sponsor slot"). No per-track licensing negotiation: one blanket ToS
// covers all free usage. These shapes are the canonical definitions; schema
// jsonb columns and services both consume them.

// A listing is the unified supply primitive. `kind` discriminates the two
// catalogs (music vs product placement); everything else is shared so both
// embed into the same vector space as a channel's ethos.
export type ListingKind = 'music' | 'placement';
export type FreeOrPaid = 'free' | 'paid';
export type PricingModel = 'flat' | 'cpm';

// A distribution channel (the demand side). A channel connects a real
// distribution surface (YouTube URL at minimum) and we pull REAL subscriber /
// view numbers via the platform's public API — never self-reported stats.
export type ChannelPlatform = 'youtube' | 'tiktok' | 'other';
export type ChannelStatus = 'pending_verification' | 'verified' | 'rejected';

// Verified distribution stats pulled from a platform public API (or the
// deterministic mock). `source` records where the numbers came from so a
// channel can never claim self-reported reach.
export interface ChannelVerification {
  source: 'youtube_data_api' | 'manual' | 'mock';
  platform: ChannelPlatform;
  platformUrl: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  verifiedAt: string;
  statsSnapshot: Record<string, unknown>;
}

export interface ChannelRow {
  id: string;
  wallet: string;
  name: string;
  handle: string;
  platform: ChannelPlatform;
  platformUrl: string;
  status: ChannelStatus;
  // The ethos embedding input: the channel's own content description/history
  // (recent video titles/descriptions, stated genre/niche).
  ethos: string | null;
  ethosTags: string[];
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  verification: ChannelVerification | null;
  // One blanket ToS click-through at channel-registration time.
  tosAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// The unified listing row surfaced in the channel feed. Both kinds embed into
// the same vector space as channel ethos; `target_ethos`/`mood_tags` are the
// structured tags that back the matching when embeddings are unavailable.
export interface ListingRow {
  submission_id: string;
  kind: ListingKind;
  title: string; // track title (music) or listing title (placement)
  supplier_name: string; // artist (music) or brand/product (placement)
  free_or_paid: FreeOrPaid;
  pricing_model: PricingModel | null;
  flat_fee_usdc: string | null;
  cpm_usdc: string | null;
  campaign_budget_usdc: string | null;
  campaign_spent_usdc: string | null;
  brand_name: string | null;
  pitch: string | null;
  target_ethos: string[];
  image_path: string | null;
  audio_path: string | null;
  audio_features: AudioFeatures | null;
  genre: string | null;
  mood_tags: MoodTagsEnvelope;
  attribution_string: string | null;
  disclosure_marker: string | null;
  status: string;
  created_at: string;
  published_at: string | null;
}

// Free-tier usage instrumentation — the data flywheel. Every free usage logs
// which channel used which listing, when, and where (video URL if available).
export type UsageKind = 'free' | 'paid';

export interface UsageEventRow {
  id: string;
  submission_id: string;
  channel_id: string | null;
  kind: UsageKind;
  video_url: string | null;
  attribution_string: string | null;
  paid_slot_id: string | null;
  tracking_code: string | null;
  used_at: string;
}

// A paid slot ("sponsor slot") — the ad-infra contract. A channel or brand
// creates/accepts a paid slot, sets budget, picks flat-fee or CPM, and checks
// out via the existing Arc/x402 rails. Each slot carries a unique trackable
// attribution code and a disclosure marker (FTC/platform sponsored-content
// requirements apply to AI-run channels same as human ones).
export type PaidSlotStatus = 'draft' | 'pending_payment' | 'active' | 'completed' | 'paused' | 'cancelled';

export interface PaidSlotRow {
  id: string;
  submission_id: string;
  kind: ListingKind;
  // Who is paying for this slot: the channel (buying a music placement) or
  // the supplier/brand (buying a product placement into a channel's content).
  buyer_wallet: string;
  buyer_role: 'channel' | 'supplier';
  channel_id: string | null;
  pricing_model: PricingModel;
  price_usdc: string; // flat fee (flat) or CPM rate (cpm)
  budget_usdc: string;
  spent_usdc: string;
  status: PaidSlotStatus;
  attribution_code: string; // unique trackable identifier
  disclosure_marker: string; // e.g. "Sponsored" / "Paid promotion"
  payment_tx_hash: string | null;
  settled_status: SettlementStatus;
  created_at: string;
  updated_at: string;
}

// Audio features extracted from the source audio for agent scoring.
// Used to make agent ratings defensible — the agents evaluate actual
// audio characteristics (tempo, energy, key, loudness, etc.) rather
// than relying solely on creator-supplied metadata.
export interface AudioFeatures {
  tempo: number | null;          // BPM
  key: string | null;            // e.g. "Am", "C#m", "Bb"
  energy: number | null;         // 0-1 (high energy / low energy)
  danceability: number | null;   // 0-1 (danceable / not)
  acousticness: number | null;   // 0-1 (acoustic / electronic)
  loudness: number | null;       // dB (typically -60 to 0)
  instrumentalness: number | null; // 0-1 (instrumental / vocal)
  valence: number | null;        // 0-1 (positive / negative mood)
  _raw?: Record<string, unknown>; // ffmpeg probe data, for future processing
}

export interface BriefSearchRow {
  submission_id: string;
  title: string;
  artist_name: string;
  version_type: string;
  audio_path: string;
  cover_svg: string | null | undefined;
  avg_solo_intensity: number | null | undefined;
  avg_vocal_quality: number | null | undefined;
  energy_consensus: string | null | undefined;
  tempo_consensus: string | null | undefined;
  rating_count: number;
  family_id?: string; // groups alternate takes / versions of the same song
  status?: string; // submission lifecycle status (for pipeline stepper)
  aggregated_mood_tags: MoodTagsEnvelope;
  published_at: string | null | undefined;
  catalog: CatalogProvenance;
  fit_score: number;
  why_fits: string[];
  license_availability: BriefSearchLicenseAvailability;
  license_quote: BriefSearchLicenseQuote;
  licensing_evidence: BriefSearchLicensingEvidence;
  brief: {
    scene_tags: string[];
    instruments: string[];
    emotional_arcs: string[];
    sync_comparables: Array<{ name: string; why: string }>;
    audience_summary: string;
  };
}

export interface BriefSearchResponse {
  rows: BriefSearchRow[];
  total: number;
  limit: number;
  offset: number;
  catalog: {
    mode: CatalogMode | null;
    demo_result_count: number;
    live_result_count: number;
  };
}
