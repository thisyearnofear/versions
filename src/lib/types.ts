export type VersionType = 'demo' | 'live' | 'acoustic' | 'remix' | 'remaster' | 'studio' | 'other';
export type Energy = 'lower' | 'same' | 'higher';
export type Tempo = 'dragging' | 'locked' | 'rushing';
export type Valence = 'bright' | 'neutral' | 'dark';
export type SubmissionStatus = 'pending_payment' | 'awaiting_curation' | 'in_curation' | 'published' | 'rejected';
export type SettlementStatus = 'pending' | 'settled' | 'failed';
export type AgentName = 'production' | 'performance' | 'market';
export type RecipientRole = 'curator' | 'platform' | 'musicbrainz';

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
// `why_fits` citations. v1 is structured-tag only — embedding
// similarity is a future PR once CLAP backfill lands.
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
  fit_score: number;
  why_fits: string[];
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
}
