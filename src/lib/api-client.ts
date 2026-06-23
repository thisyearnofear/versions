// MODULAR: typed API client. Single base URL + JSON helpers. Every
// fetch in the app goes through this — no raw fetch() in components.
// Backed by the Next.js App Router (the same origin serves the page
// and the /api routes), so the base URL is empty.

import type {
  AgentName,
  AgentReview,
  PlacementBrief,
  RecipientRole,
} from "./types";

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

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
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
  mood_tags?: string[];
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
  aggregated_mood_tags?: string | null;
  published_at?: string | null;
}

export interface FeedResponse {
  rows: FeedRow[];
  total?: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  genre?: string | null;
  mood?: string | null;
  track_count: number;
  tracks?: FeedRow[];
}

export interface EarningsResponse {
  total: number;
  by_role: Array<{ role: RecipientRole; total: number; leg_count: number }>;
  recent: Array<{
    submission_id: string;
    submission_title?: string | null;
    artist_name?: string | null;
    role: RecipientRole;
    amount: string;
    settled_at?: string | null;
  }>;
  recent_total?: number;
}

export interface ArtistVersionsResponse {
  rows: Array<SubmissionRecord & { published?: { avg_solo_intensity: number; avg_vocal_quality: number; energy_consensus: string; tempo_consensus: string } }>;
  total: number;
}

export interface VerifyPaymentResponse {
  status: string;
}

export interface ArcInfo {
  mock: boolean;
  usdcContract?: string;
  platformWallet?: string;
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
    moodTags: string[];
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
  recent_published: Array<{
    submissionId: string;
    title: string;
    artistName: string;
    versionType: string;
    avgSoloIntensity: number | null;
    avgVocalQuality: number | null;
    energyConsensus: string | null;
    tempoConsensus: string | null;
    ratingCount: number;
    publishedAt: Date;
  }>;
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
  getReviews(submissionId: string): Promise<AgentReviewRecord[]> {
    return api.get<AgentReviewRecord[]>(`/api/v1/submissions/${submissionId}/reviews`);
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
  getFeed(params: Record<string, string | number | undefined> = {}): Promise<FeedResponse> {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") usp.set(k, String(v));
    }
    const qs = usp.toString();
    return api.get<FeedResponse>(`/api/v1/feed${qs ? `?${qs}` : ""}`);
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
