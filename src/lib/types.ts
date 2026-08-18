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
// separate from version type, ranking quality, and rights clearance.
// 'authorized' = published from a submission inside an artist-authorized
// version program (pilot) — the one source where pre-clearance is a fact
// (consent recorded per version) rather than an assumption.
export type CatalogSource = 'demo' | 'live' | 'authorized';
export type CatalogMode = 'guided_demo' | 'live_catalog' | 'mixed';
export interface CatalogProvenance {
  source: CatalogSource;
  label: 'Guided demo' | 'Live catalog' | 'Authorized program';
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
  status: 'sample_only' | 'rights_review_required' | 'program_cleared';
  summary: string;
  outstanding: Array<{
    requirement: 'rights_authority' | 'scope_and_restrictions' | 'final_quote';
    description: string;
  }>;
}

// ── Authorized version programs (pilot) ────────────────
// MODULAR: the consent record + royalty waterfall for an artist-authorized
// version program. The concierge pilot mirrors ONE lawyer-drafted agreement
// per program; these shapes are the structured slice of that agreement that
// the platform needs to gate, evidence, and settle. Canonical definitions —
// schema.jsonb and services both consume these.
export type ProgramStatus = 'active' | 'revoked' | 'completed';
export type AuthorizationStatus = 'pending_approval' | 'approved' | 'rejected';

export interface ConsentPolicy {
  allowed_transformations: string[]; // e.g. ['alt_vocals', 'remix', 'mood_flip']
  prohibited: string[];
  territories: string[]; // ['worldwide'] or ISO codes
  term_months: number;
  revocable: boolean;
  model_training_allowed: boolean;
  notes?: string; // free-text summary of the signed agreement
  agreement_ref?: string; // pointer to the signed document (path/URL)
}

// One leg of the per-use royalty waterfall. share_bps is basis points; legs
// must sum to exactly 10000 (100%).
export interface RoyaltySplit {
  wallet: string;
  label: string; // 'artist' | 'creator' | 'publisher' | 'platform' | ...
  share_bps: number;
}

// Derivative-version provenance: how this version was made and from what.
export interface VersionLineage {
  creator_tools: string[]; // tool-agnostic labels, e.g. ['suno', 'manual_mix']
  source_version_ids: string[]; // upstream versions/stems used, if any
  notes?: string;
}

// Read-side gate for the license route: is this version still inside an
// active, artist-approved program? Derived at read time so a program
// revocation stops new licenses immediately without touching old rows.
export interface ProgramGate {
  program_id: string;
  program_status: ProgramStatus;
  rights_holder_wallet: string;
  authorization_status: AuthorizationStatus | null;
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
