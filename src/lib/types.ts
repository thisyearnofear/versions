import type { LicenseUsageType } from './pricing';

export type VersionType = 'demo' | 'live' | 'acoustic' | 'remix' | 'remaster' | 'studio' | 'other';
export type Energy = 'lower' | 'same' | 'higher';
export type Tempo = 'dragging' | 'locked' | 'rushing';
export type Valence = 'bright' | 'neutral' | 'dark';
export type SubmissionStatus = 'pending_payment' | 'awaiting_curation' | 'in_curation' | 'published' | 'rejected';
export type SettlementStatus = 'pending' | 'settled' | 'failed';
export type AgentName = 'production' | 'performance' | 'market';
export type RecipientRole = 'curator' | 'platform' | 'musicbrainz';

// Catalog provenance describes where a take came from. It is intentionally
// separate from version type and ranking quality.
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
  // authenticated workflow. Authorized-program tracks are the only state
  // where clearance is recorded per version ('cleared').
  status: 'demo_preview' | 'requestable';
  reason: string;
  clearance: {
    status: 'unverified' | 'cleared';
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

// ── Marketplace supply: unified listing ───────────────
// MODULAR: one primitive, two supply catalogs. A listing is a slot in a
// feed that a channel can pick up — either a track (music) or a
// brand/product (placement). Both are matched against channel ethos in the
// same vector space and both are either free-with-attribution or paid.
// There is no per-listing licensing negotiation: one blanket agreement
// covers every free use, and a paid listing is a self-serve buy.
export type ListingKind = 'music' | 'placement';
export type ListingTier = 'free' | 'paid';
export type PricingModel = 'flat' | 'cpm';
export type ListingStatus = 'draft' | 'active' | 'paused' | 'exhausted' | 'archived';

export interface ListingPricing {
  model: PricingModel;
  // Required when model === 'flat'. Decimal USDC string.
  flatFeeUsdc?: string;
  // Required when model === 'cpm'. Decimal USDC per 1000 impressions.
  cpmUsdc?: string;
}

// ── Compliance surface ────────────────────────────────
// Paid placements carry a disclosure marker from day one. FTC / platform
// sponsored-content rules apply to AI-run channels exactly as they do to
// human ones, so the marker is generated into the attribution string the
// channel is required to render — not left to the channel to remember.
export type DisclosureKind = 'sponsored' | 'paid_promotion';

export interface Disclosure {
  kind: DisclosureKind;
  // Short in-video/description tag, e.g. "#ad".
  label: string;
  // Full sentence the channel must render alongside the attribution.
  statement: string;
}

// ── Demand side: distribution channels ────────────────
export type ChannelPlatform = 'youtube' | 'other';
export type ChannelVerification = 'pending' | 'verified' | 'failed';
export type ChannelStatus = 'active' | 'suspended';

// Provenance of a channel's distribution numbers. 'self_reported' is
// deliberately absent — fake distribution is the fraud that undermines ad
// marketplaces, so the numbers always come from the platform's own API
// (or from the deterministic mock in environments without a key).
export type StatsSource = 'platform_api' | 'mock';

export interface ChannelStats {
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  source: StatsSource;
  verifiedAt: string | null;
}

// ── Paid tier: sponsor slots ──────────────────────────
export type SlotStatus =
  | 'pending_payment'
  | 'active'
  | 'paused'
  | 'exhausted'
  | 'completed'
  | 'cancelled';

// ── Usage instrumentation (the data flywheel) ─────────
// Organic = free-with-attribution. Sponsored = paid slot delivery. Every
// use of every listing is logged — which channel, which listing, when, and
// where (video URL when available) — so the catalog's usage is both a
// matching signal and the sales proof for the paid side.
export type UsageKind = 'organic' | 'sponsored';
export type UsageReportedBy = 'channel' | 'platform_api' | 'manual';

// Roles in the flat slot split. Exactly three legs, no waterfall: the
// supplier who owns the listing, the channel that delivered it, and the
// platform that matched and settled it.
export type SlotRecipientRole = 'supplier' | 'channel' | 'platform';

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
