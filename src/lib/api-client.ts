// MODULAR: typed API client. Single base URL + JSON helpers. Every
// fetch in the app goes through this — no raw fetch() in components.
// Backed by the Next.js App Router (the same origin serves the page
// and the /api routes), so the base URL is empty.

import { getGuestId } from "./guest-id";
import type {
  AgentName,
  BriefSearchResponse,
  MoodTagsEnvelope,
  PlacementBrief,
  RecipientRole,
} from "./types";
import type { MatchBenchmarkReport } from "./match-benchmark";

// MODULAR: every api-client field that carries user-curator mood
// tags arrives in one of two wire shapes -- a JSON-stringified
// string array OR a Drizzle jsonb round-tripped JS array. The
// four-arm union (string | string[] | null | undefined) covers
// both possible values AND explicit unset at the type level.
// Use this as the declared type on every mood-tag-shaped
// envelope field, then route through `parseMoodTags(raw)` in
// @/lib/format before reaching for `.length` / `.map` / passing
// to `deriveValence` -- unpadded accesses fail typecheck by
// design so a future contributor cannot silently drop the
// valence / chip signal on the wrong shape again (the same bug
// pattern AgentMonitor, CuratorDashboard and DiscoverView
// escaped in prior rounds).
//
// Convention: OUTER-OPTIONAL fields declare as `?: MoodTagsEnvelope`
// (the `?` adds `| undefined` twice -- harmless, mirrors the repo
// style); INNER fields inside an outer-optional block declare as
// `: MoodTagsEnvelope` so "field missing" (entire `published?`
// or empty `recent_ratings[]`) stays distinct from "value is
// undefined" on a present field.
//
// MODULAR: the canonical MoodTagsEnvelope + BriefSearchResponse live
// in `@/lib/types` (source of truth). Re-export here so existing
// `import { MoodTagsEnvelope } from '@/lib/api-client'` call sites
// keep working without churn.
export type { MoodTagsEnvelope, BriefSearchResponse, BriefSearchRow } from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  body: unknown;
  constructor(message: string, code: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

type Envelope<T> = { data?: T; success?: boolean; error?: { message: string; code?: string } };

// MODULAR: wallet-free supervisor journey. Attach the per-device
// guest identity (when present) to every request so supervisor
// routes can resolve it server-side (see supervisor-identity.ts).
// Server-side importers (normalizeFeedRow etc.) never hit this
// because getGuestId() returns null without a window.
function guestHeaders(): Record<string, string> {
  const id = getGuestId();
  return id ? { "x-supervisor-guest": id } : {};
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...guestHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  };
  const res = await fetch(path, init);
  const text = await res.text();
  let json: Envelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as Envelope<T>) : null;
  } catch {
    json = { success: false, error: { message: text } };
  }
  if (!res.ok) {
    const errPayload = json?.error ?? { message: `HTTP ${res.status}` };
    throw new ApiError(errPayload.message, errPayload.code ?? "HTTP_ERROR", res.status, json);
  }
  if (json && json.data !== undefined) return json.data;
  return (json as unknown as T) ?? (null as unknown as T);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

// ---------- typed endpoint helpers ----------

export interface SubmissionMetadata {
  title: string;
  artistName: string;
  versionType: string;
  genre?: string | null;
  mood?: string | null;
  description?: string | null;
  musicbrainzId?: string | null;
  coverSvg?: string | null;
}

export interface SubmissionRecord {
  id: string;
  artistWallet: string;
  title: string;
  artistName: string;
  versionType: string;
  genre?: string | null;
  status: string;
  ratingCount?: number;
  audioPath: string;
  coverSvg?: string | null;
  publishedAt?: string | null;
  submittedAt?: string | null;
}

export interface QueueSubmission {
  id: string;
  title: string;
  artist_name: string;
  version_type: string;
  genre?: string | null;
  ratingCount?: number;
  status?: string;
  published_at?: string | null;
  payment_tx_hash?: string | null;
}

export interface RatingInput {
  solo_intensity: number;
  vocal_quality: number;
  energy_vs_studio: "lower" | "same" | "higher";
  tempo_feel: "dragging" | "locked" | "rushing";
  mood_tags: string[];
  notes?: string | null;
}

export interface RateResponse {
  rating_count: number;
  published?: { alreadyPublished?: boolean };
}

export interface ClaimResponse {
  ok: boolean;
  error?: string;
}

export interface AgentReviewRecord {
  submission_id: string;
  agent_name: AgentName;
  notes?: string | null;
  mood_tags?: MoodTagsEnvelope;
  solo_intensity: number;
  vocal_quality: number;
  energy_vs_studio: "lower" | "same" | "higher";
  tempo_feel: "dragging" | "locked" | "rushing";
  placement_brief?: PlacementBrief;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BriefResponse extends PlacementBrief {}

export interface FeedRow {
  submission_id: string;
  title: string;
  artist_name: string;
  version_type: string;
  audio_path: string;
  cover_svg?: string | null;
  avg_solo_intensity?: number | null;
  avg_vocal_quality?: number | null;
  energy_consensus?: string | null;
  tempo_consensus?: string | null;
  rating_count: number;
  aggregated_mood_tags?: MoodTagsEnvelope;
  published_at?: string | null;
  catalog_source: 'demo' | 'live';
}

export interface FeedResponse {
  rows: FeedRow[];
  total?: number;
}

// The feed service emits Drizzle camelCase rows (submissionId, coverSvg, …)
// while the UI contract is snake_case. Normalize at the boundary, accepting
// either shape so server-side loads and the HTTP API stay interchangeable.
export function normalizeFeedRow(raw: Record<string, unknown>): FeedRow {
  const pick = <T>(a: unknown, b: unknown): T => (a !== undefined ? a : b) as T;
  return {
    submission_id: pick(raw.submission_id, raw.submissionId),
    title: pick(raw.title, ""),
    artist_name: pick(raw.artist_name, raw.artistName),
    version_type: pick(raw.version_type, raw.versionType),
    audio_path: pick(raw.audio_path, raw.audioPath),
    cover_svg: pick(raw.cover_svg, raw.coverSvg),
    avg_solo_intensity: pick(raw.avg_solo_intensity, raw.avgSoloIntensity),
    avg_vocal_quality: pick(raw.avg_vocal_quality, raw.avgVocalQuality),
    energy_consensus: pick(raw.energy_consensus, raw.energyConsensus),
    tempo_consensus: pick(raw.tempo_consensus, raw.tempoConsensus),
    rating_count: pick(raw.rating_count, raw.ratingCount),
    aggregated_mood_tags: pick(raw.aggregated_mood_tags, raw.aggregatedMoodTags),
    published_at: pick(raw.published_at, raw.publishedAt),
    catalog_source: pick(raw.catalog_source, raw.catalogSource),
  };
}

// Same boundary rule as normalizeFeedRow: the reviews route emits
// Drizzle camelCase rows but AgentReviewRecord is snake_case.
export function normalizeReviewRow(raw: Record<string, unknown>): AgentReviewRecord {
  const pick = <T>(a: unknown, b: unknown): T => (a !== undefined ? a : b) as T;
  return {
    submission_id: pick(raw.submission_id, raw.submissionId),
    agent_name: pick(raw.agent_name, raw.agentName),
    notes: pick(raw.notes, null),
    mood_tags: pick(raw.mood_tags, raw.moodTags),
    solo_intensity: pick(raw.solo_intensity, raw.soloIntensity),
    vocal_quality: pick(raw.vocal_quality, raw.vocalQuality),
    energy_vs_studio: pick(raw.energy_vs_studio, raw.energyVsStudio),
    tempo_feel: pick(raw.tempo_feel, raw.tempoFeel),
    placement_brief: pick(raw.placement_brief, raw.placementBrief),
  };
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  genre?: string | null;
  mood?: string | null;
  reasoning?: string | null;
  track_count: number;
  tracks?: FeedRow[];
}

export interface EarningsResponse {
  total: number;
  by_role: Array<{ role: RecipientRole | 'license'; total: number; leg_count: number }>;
  recent: Array<{
    id: string;
    submission_id: string;
    submission_title?: string | null;
    artist_name?: string | null;
    role: RecipientRole | 'license';
    amount: string;
    settled_at?: string | null;
  }>;
  recent_total?: number;
}

export type ReceiptSource = 'split' | 'tip' | 'play' | 'license';

export interface ReceiptRowResponse {
  id: string;
  source: ReceiptSource;
  amount_usdc: string;
  tx_hash: string | null;
  status: string;
  occurred_at: string | null;
  counterparty: string | null;
  submission_id: string | null;
  title: string | null;
  detail: string | null;
  // Null means the persisted receipt does not record whether execution was mock or live.
  mock: boolean | null;
}

export interface ReceiptsResponse {
  wallet: string;
  totals: { all: number; splits: number; tips: number; plays: number; licenses: number };
  counts: { splits: number; tips: number; plays: number; licenses: number };
  rows: ReceiptRowResponse[];
  total_rows: number;
}

export interface ArtistVersionsResponse {
  rows: Array<SubmissionRecord & {
    published?: {
      avg_solo_intensity: number | null;
      avg_vocal_quality: number | null;
      energy_consensus: string | null;
      tempo_consensus: string | null;
      aggregated_mood_tags: MoodTagsEnvelope;
    };
  }>;
  total: number;
}

// MODULAR: slim response for the TipButton hover-card. Two small
// arrays + two scalars — bandwidth stays under ~3 kB even for
// artists with ≥ 50 published rows. matches recent_published /
// recent_tips shapes from curation.getArtistTipCard verbatim.
export interface ArtistTipCardResponse {
  artist_wallet: string;
  total_tips: number;
  total_tips_usdc: string;
  recent_published: Array<{
    submission_id: string;
    title: string;
    version_type: string;
    avg_solo_intensity: number | null;
    avg_vocal_quality: number | null;
    energy_consensus: string | null;
    tempo_consensus: string | null;
    aggregated_mood_tags: string[] | null;
    rating_count: number;
    published_at: string;
  }>;
  recent_tips: Array<{
    puid: string;
    tipper_wallet: string;
    amount_micro_usdc: string;
    amount_usdc: string;
    message: string | null;
    settled_at: string | null;
    created_at: string;
  }>;
}

export interface VerifyPaymentResponse {
  status: string;
}

// MODULAR: full ArcInfo shape mirrors src/adapters/arc.ts#ArcInfo.
// Only the fields needed by the client for payment wiring are typed
// non-optional; the rest stay optional because the server returns
// nulls in mock mode (no RPC → no chainId / contract deployed).
export interface ArcInfo {
  mock: boolean;
  chainId?: string | null;
  rpcUrl?: string | null;
  usdcContract?: string | null;
  usdcDecimals?: number;
  platformWallet?: string | null;
  platformUsdcBalance?: string | null;
}

// ── Listener incentive types ──────────────────────────

export interface ListenerBadgeResponse {
  id: string;
  badgeType: string;
  label: string;
  description: string;
  icon: string;
  awardedAt: string;
}

export interface ListenerProfileResponse {
  wallet: string;
  reputationScore: number;
  freePlaysRemaining: number;
  freePlaysDailyLimit: number;
  freePlaysUsedToday: number;
  totalPlays: number;
  totalPaidPlays: number;
  totalFreePlays: number;
  distinctTracksPlayed: number;
  lastPlayedAt: string | null;
  streakDays: number;
  badges: ListenerBadgeResponse[];
}

export interface PlayResponse {
  id: string;
  playlist_id: string;
  version_id: string;
  listener_wallet: string;
  artist_wallet: string;
  listener_fee_usdc: string;
  artist_payout_usdc: string;
  listener_tx_hash: string | null;
  artist_tx_hash: string | null;
  status: string;
  play_type: 'free' | 'paid';
  free_plays_remaining: number;
  reputation_earned: number;
  new_badges: ListenerBadgeResponse[];
}

export interface PlayHistoryEntry {
  id: string;
  versionId: string;
  playlistId: string;
  playlistName: string | null;
  title: string | null;
  artistName: string | null;
  listenerFeeUsdc: string;
  artistPayoutUsdc: string;
  playType: 'free' | 'paid';
  status: string;
  playedAt: string;
}

export interface PlayHistoryResponse {
  rows: PlayHistoryEntry[];
  total: number;
}

// curator profile — ratings history and earnings
export interface CuratorProfileResponse {
  wallet: string;
  ratings_count: number;
  total_earned_usdc: number;
  recent_ratings: Array<{
    id: string;
    submissionId: string;
    soloIntensity: number;
    vocalQuality: number;
    energyVsStudio: string;
    tempoFeel: string;
    moodTags: MoodTagsEnvelope;
    notes: string | null;
    submittedAt: string;
    title: string | null;
    artist_name: string | null;
  }>;
}

// artist profile — aggregates total submissions, published, earnings, recent activity
export interface ArtistProfileResponse {
  wallet: string;
  submissions_count: number;
  published_count: number;
  total_received_usdc: number;
  recent_submissions: Array<{
    id: string;
    title: string;
    artistName: string;
    status: string;
    versionType: string;
    submittedAt: Date;
    publishedAt: Date | null;
  }>;
  // MODULAR: aggregated_mood_tags is the union of mood_tags across all
  // ratings of a published version -- the source for the 5th radar
  // axis (valence) which derives qualitatively from lexical polarity
  // (see services/taste-graph.ts -> deriveValence). The dashboard
  // reads it client-side to avoid a DB migration that would persist
  // valence_consensus alongside energy/tempo_consensus.
  recent_published: Array<{
    submissionId: string;
    title: string;
    artistName: string;
    versionType: string;
    avgSoloIntensity: number | null;
    avgVocalQuality: number | null;
    energyConsensus: string | null;
    tempoConsensus: string | null;
    aggregatedMoodTags: MoodTagsEnvelope;
    ratingCount: number;
    publishedAt: Date;
  }>;
}

// ── Supervisor dashboard types ────────────────────────

export interface SupervisorProfile {
  wallet: string;
  email: string | null;
  name: string | null;
  company: string | null;
  role: "supervisor" | "sync_house" | "aandr";
  createdAt: string;
  updatedAt: string;
}

export interface SavedBrief {
  id: string;
  supervisor_wallet: string;
  brief_text: string;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BriefSearchRecord {
  id: string;
  supervisor_wallet: string;
  brief_text: string;
  filters: Record<string, unknown>;
  results_count: number;
  created_at: string;
}

export interface LicensingInterest {
  id: string;
  supervisor_wallet: string;
  submission_id: string;
  title?: string | null;
  artist_name?: string | null;
  artist_wallet?: string | null;
  status: "interested" | "contacted" | "licensed" | "passed";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaceCaseStep {
  key: string;
  label: string;
  done: boolean;
  current?: boolean;
}

export interface PlaceCaseEvidence {
  rankedCount?: number;
  shortlistSubmissionIds?: string[];
  recommendationText?: string;
}

/** Persistent supervisor work object: the brief + the agent plan + the evidence + the one human decision it is waiting on. */
export interface PlacementCaseRow {
  id: string;
  supervisor_wallet: string;
  kind: string;
  brief_text: string;
  status: string;
  objective: string | null;
  pending_decision: string | null;
  agent_plan: PlaceCaseStep[];
  evidence: PlaceCaseEvidence;
  ranked_count: number;
  shortlist_count: number;
  last_activity: string;
  created_at: string;
  updated_at: string;
  latest_event?: { kind: string; created_at: string } | null;
}

export interface CaseEventRow {
  id: string;
  case_id: string;
  kind: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface MatchFeedbackRow {
  id: string;
  supervisor_wallet: string;
  brief_hash: string;
  brief_text: string;
  submission_id: string;
  catalog_source: 'demo' | 'live';
  fit_score_shown: number;
  rank_shown: number | null;
  verdict: "good_fit" | "wrong_fit";
  created_at: string;
  updated_at: string;
}

export type LicenseUsageType = "sync_ad" | "sync_tv_film" | "sync_digital" | "other";

export interface LicenseRow {
  id: string;
  supervisor_wallet: string;
  submission_id: string;
  brief_hash: string;
  brief_text: string;
  usage_type: LicenseUsageType;
  territory: string;
  term_months: number;
  fee_usdc: string;
  status: "pending_payment" | "settling" | "paid";
  payment_tx_hash: string | null;
  payment_mock: boolean;
  job_id: string | null;
  job_status: string | null;
  deliverable_hash: string | null;
  job_create_tx_hash: string | null;
  job_complete_tx_hash: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
  title?: string | null;
  artist_name?: string | null;
  artist_wallet?: string | null;
}

export interface AgentIdentityRow {
  label: string;
  name: string;
  wallet: string;
  agentId: string;
  registry: string;
  mock: boolean;
  registered: boolean;
}

// ---------- typed wrappers ----------

export const apiClient = {
  // submissions
  createSubmission(form: FormData): Promise<SubmissionRecord> {
    return fetch("/api/v1/submissions", { method: "POST", body: form }).then((r) =>
      handleFetch<SubmissionRecord>(r),
    );
  },
  verifyPayment(submissionId: string, body: { txHash: string }): Promise<VerifyPaymentResponse> {
    return api.post<VerifyPaymentResponse>(`/api/v1/submissions/${submissionId}/verify-payment`, body);
  },
  async getReviews(submissionId: string): Promise<AgentReviewRecord[]> {
    const rows = await api.get<Array<Record<string, unknown>>>(`/api/v1/submissions/${submissionId}/reviews`);
    return (Array.isArray(rows) ? rows : []).map(normalizeReviewRow);
  },
  getBrief(submissionId: string): Promise<BriefResponse> {
    return api.get<BriefResponse>(`/api/v1/submissions/${submissionId}/brief`);
  },
  getQueue(limit = 50): Promise<QueueSubmission[]> {
    return api.get<QueueSubmission[]>(`/api/v1/submissions/queue?limit=${limit}`);
  },
  claim(submissionId: string, body: { curatorWallet: string; signature: string }): Promise<ClaimResponse> {
    return api.post<ClaimResponse>(`/api/v1/submissions/${submissionId}/claim`, body);
  },
  releaseClaim(submissionId: string, body: { curatorWallet: string }): Promise<void> {
    return api.delete<void>(`/api/v1/submissions/${submissionId}/claim`, body);
  },
  rate(submissionId: string, body: { curatorWallet: string; signature: string; rating: RatingInput }): Promise<RateResponse> {
    return api.post<RateResponse>(`/api/v1/submissions/${submissionId}/rate`, body);
  },

  // feed
  async getFeed(params: Record<string, string | number | undefined> = {}): Promise<FeedResponse> {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") usp.set(k, String(v));
    }
    const qs = usp.toString();
    const resp = await api.get<{ rows?: Array<Record<string, unknown>>; total?: number }>(
      `/api/v1/feed${qs ? `?${qs}` : ""}`,
    );
    return { rows: (resp?.rows ?? []).map(normalizeFeedRow), total: resp?.total };
  },

  // MODULAR: supervisor inverse-search. Brief text is mandatory;
  // structured filters (sceneTags, instruments, energy, tempo) are
  // comma-separated CSV strings. The server clamps/validates and
  // throws ApiError with code INVALID_BRIEF on out-of-range text.
  searchByBrief(args: {
    brief: string;
    sceneTags?: string;
    instruments?: string;
    energy?: string;
    tempo?: string;
    limit?: number;
    offset?: number;
  }): Promise<BriefSearchResponse> {
    const usp = new URLSearchParams();
    usp.set("brief", args.brief);
    if (args.sceneTags) usp.set("sceneTags", args.sceneTags);
    if (args.instruments) usp.set("instruments", args.instruments);
    if (args.energy) usp.set("energy", args.energy);
    if (args.tempo) usp.set("tempo", args.tempo);
    usp.set("limit", String(args.limit ?? 20));
    usp.set("offset", String(args.offset ?? 0));
    return api.get<BriefSearchResponse>(`/api/v1/discover/brief?${usp.toString()}`);
  },

  // playlists
  getPlaylists(): Promise<Playlist[]> {
    return api.get<Playlist[]>("/api/v1/ar/playlists");
  },
  generatePlaylists(): Promise<{ generated: number }> {
    return api.post<{ generated: number }>("/api/v1/ar/playlists/generate");
  },
  play(payload: { playlistId: string; versionId: string; listenerWallet: string }): Promise<PlayResponse> {
    return api.post<PlayResponse>("/api/v1/ar/play", payload);
  },

  // artist + curator dashboards
  getCuratorProfile(wallet: string): Promise<CuratorProfileResponse> {
    return api.get<CuratorProfileResponse>(`/api/v1/curators/${encodeURIComponent(wallet)}`);
  },
  getArtistProfile(wallet: string): Promise<ArtistProfileResponse> {
    return api.get<ArtistProfileResponse>(`/api/v1/artists/${encodeURIComponent(wallet)}`);
  },
  getArtistVersions(wallet: string, limit = 20): Promise<ArtistVersionsResponse> {
    return api.get<ArtistVersionsResponse>(`/api/v1/artists/${encodeURIComponent(wallet)}/versions?limit=${limit}`);
  },
  // MODULAR: TipButton hover-card payload. Returns 3 most-recent
      // published + 5 most-recent x402 nanopayment tips + footer
      // aggregates in one fetch. Reuses curation.getArtistTipCard
      // which fans out to pvTable + x402_proofs in parallel.
      getArtistTipCard(wallet: string): Promise<ArtistTipCardResponse> {
        return api.get<ArtistTipCardResponse>(`/api/v1/artists/${encodeURIComponent(wallet)}/tip-card`);
      },
      getArtistEarnings(wallet: string, opts?: { limit?: number; offset?: number; role?: string; dateFrom?: string; dateTo?: string }): Promise<EarningsResponse> {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 10));
    params.set("offset", String(opts?.offset ?? 0));
    if (opts?.role) params.set("role", opts.role);
    if (opts?.dateFrom) params.set("dateFrom", opts.dateFrom);
    if (opts?.dateTo) params.set("dateTo", opts.dateTo);
    return api.get<EarningsResponse>(
      `/api/v1/artists/${encodeURIComponent(wallet)}/earnings?${params.toString()}`,
    );
  },
  getArtistReceipts(wallet: string, opts?: { limit?: number; offset?: number; source?: ReceiptSource }): Promise<ReceiptsResponse> {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 20));
    params.set("offset", String(opts?.offset ?? 0));
    if (opts?.source) params.set("source", opts.source);
    return api.get<ReceiptsResponse>(
      `/api/v1/artists/${encodeURIComponent(wallet)}/receipts?${params.toString()}`,
    );
  },

  // listener profile / incentives
  getListenerProfile(wallet: string): Promise<ListenerProfileResponse> {
    return api.get<ListenerProfileResponse>(`/api/v1/listeners/${encodeURIComponent(wallet)}`);
  },
  getListenerHistory(wallet: string, opts?: { limit?: number; offset?: number; playType?: string; status?: string; dateFrom?: string; dateTo?: string }): Promise<PlayHistoryResponse> {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 50));
    params.set("offset", String(opts?.offset ?? 0));
    if (opts?.playType) params.set("playType", opts.playType);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.dateFrom) params.set("dateFrom", opts.dateFrom);
    if (opts?.dateTo) params.set("dateTo", opts.dateTo);
    return api.get<PlayHistoryResponse>(
      `/api/v1/listeners/${encodeURIComponent(wallet)}/history?${params.toString()}`,
    );
  },

  // payment
  getArcInfo(): Promise<ArcInfo> {
    return api.get<ArcInfo>("/api/v1/arc/info");
  },

  // supervisor dashboard
  getSupervisorProfile(): Promise<{ profile: SupervisorProfile | null }> {
    return api.get<{ profile: SupervisorProfile | null }>("/api/v1/supervisor/profile");
  },
  updateSupervisorProfile(body: { email?: string; name?: string; company?: string; role?: string }): Promise<{ profile: SupervisorProfile }> {
    return api.put<{ profile: SupervisorProfile }>("/api/v1/supervisor/profile", body);
  },
  getSavedBriefs(opts?: { limit?: number; offset?: number; search?: string }): Promise<{ rows: SavedBrief[]; total: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts?.search) params.set("search", opts.search);
    const qs = params.toString();
    return api.get<{ rows: SavedBrief[]; total: number }>(`/api/v1/supervisor/saved-briefs${qs ? `?${qs}` : ""}`);
  },
  saveBrief(body: { briefText: string; filters?: Record<string, unknown> }): Promise<{ row: SavedBrief }> {
    return api.post<{ row: SavedBrief }>("/api/v1/supervisor/saved-briefs", body);
  },
  deleteSavedBrief(id: string): Promise<{ ok: boolean }> {
    return api.delete<{ ok: boolean }>(`/api/v1/supervisor/saved-briefs?id=${encodeURIComponent(id)}`);
  },
  getRecentSearches(opts?: { limit?: number; offset?: number; search?: string }): Promise<{ rows: BriefSearchRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts?.search) params.set("search", opts.search);
    const qs = params.toString();
    return api.get<{ rows: BriefSearchRecord[]; total: number }>(`/api/v1/supervisor/recent-searches${qs ? `?${qs}` : ""}`);
  },
  logSearch(body: { briefText: string; filters?: Record<string, unknown>; resultsCount?: number }): Promise<{ row: BriefSearchRecord }> {
    return api.post<{ row: BriefSearchRecord }>("/api/v1/supervisor/recent-searches", body);
  },
  getInterests(opts?: { limit?: number; offset?: number }): Promise<{ rows: LicensingInterest[]; total: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ rows: LicensingInterest[]; total: number }>(`/api/v1/supervisor/interests${qs ? `?${qs}` : ""}`);
  },
  addInterest(body: { submissionId: string; status?: string; notes?: string }): Promise<{ row: LicensingInterest }> {
    return api.post<{ row: LicensingInterest }>("/api/v1/supervisor/interests", body);
  },
  updateInterest(body: { id: string; status?: string; notes?: string }): Promise<{ row: LicensingInterest }> {
    return api.patch<{ row: LicensingInterest }>("/api/v1/supervisor/interests", body);
  },
  /** Open (or resume) a persistent placement case for a brief. */
  openCase(body: { briefText: string; rankedCount?: number; pendingDecision?: string | null }): Promise<{ row: PlacementCaseRow }> {
    return api.post<{ row: PlacementCaseRow }>("/api/v1/cases", body);
  },
  getCases(opts?: { limit?: number }): Promise<{ rows: PlacementCaseRow[]; open: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ rows: PlacementCaseRow[]; open: number }>(`/api/v1/cases${qs ? `?${qs}` : ""}`);
  },
  getCase(id: string): Promise<{ case: PlacementCaseRow; events: CaseEventRow[] }> {
    return api.get<{ case: PlacementCaseRow; events: CaseEventRow[] }>(`/api/v1/cases/${encodeURIComponent(id)}`);
  },
  /** Attach a shortlisted take to the supervisor's current open case. */
  addCaseShortlist(body: { submissionId: string }): Promise<{ row: PlacementCaseRow }> {
    return api.post<{ row: PlacementCaseRow }>("/api/v1/cases/shortlist", body);
  },
  /** Record the human decision that clears a case's pending gate. */
  recordCaseDecision(id: string, body: { status?: string; clearPending?: boolean; note?: string | null }): Promise<{ row: PlacementCaseRow }> {
    return api.patch<{ row: PlacementCaseRow }>(`/api/v1/cases/${encodeURIComponent(id)}`, body);
  },
  /** Record supervisor ground-truth on a shown (brief → take) match. */
  recordMatchFeedback(body: {
    briefHash: string;
    briefText: string;
    submissionId: string;
    fitScoreShown: number;
    rankShown?: number | null;
    verdict: "good_fit" | "wrong_fit";
  }): Promise<{ row: MatchFeedbackRow }> {
    return api.post<{ row: MatchFeedbackRow }>("/api/v1/discover/brief/feedback", body);
  },
  /** Create a license for a matched take (usage → fee derived server-side). */
  createLicense(body: {
    submissionId: string;
    briefHash: string;
    briefText: string;
    usageType: LicenseUsageType;
  }): Promise<{ license: LicenseRow }> {
    return api.post<{ license: LicenseRow }>("/api/v1/licenses", body);
  },
  getLicenses(opts?: { limit?: number; offset?: number }): Promise<{ rows: LicenseRow[]; total: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ rows: LicenseRow[]; total: number }>(`/api/v1/licenses${qs ? `?${qs}` : ""}`);
  },
  getLicense(id: string): Promise<{ license: LicenseRow }> {
    return api.get<{ license: LicenseRow }>(`/api/v1/licenses/${encodeURIComponent(id)}`);
  },
  payLicense(id: string): Promise<{
    license: LicenseRow;
    settled?: {
      txHash: string;
      mock: boolean;
      jobId?: string;
      jobStatus?: string;
      completeTxHash?: string;
      deliverableHash?: string;
    };
  }> {
    return api.post<{
      license: LicenseRow;
      settled?: {
        txHash: string;
        mock: boolean;
        jobId?: string;
        jobStatus?: string;
        completeTxHash?: string;
        deliverableHash?: string;
      };
    }>(`/api/v1/licenses/${encodeURIComponent(id)}`);
  },
  getAgentIdentities(): Promise<{
    registry: string;
    mock: boolean;
    agents: AgentIdentityRow[];
  }> {
    return api.get("/api/v1/agents/identities");
  },
  /** Read-only match-quality report (ground-truth moat). */
  getMatchBenchmark(): Promise<{ report: MatchBenchmarkReport }> {
    return api.get<{ report: MatchBenchmarkReport }>("/api/v1/discover/benchmark");
  },
};

async function handleFetch<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: Envelope<T> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Envelope<T>) : null;
  } catch {
    parsed = { success: false, error: { message: text } };
  }
  if (!res.ok) {
    const errPayload = parsed?.error ?? { message: `HTTP ${res.status}` };
    throw new ApiError(errPayload.message, errPayload.code ?? "HTTP_ERROR", res.status, parsed);
  }
  if (parsed && parsed.data !== undefined) return parsed.data;
  return (parsed as unknown as T) ?? (null as unknown as T);
}
