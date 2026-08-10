// MODULAR: Versioned, published contract for the VERSIONS primitive —
// "a brief → a pre-cleared, attributed, micro-settled license." This is the
// wedge we sell to catalogs / labels / DSPs who are disincentivized to build
// it. The endpoint ROUTES implement this contract; the shapes below are the
// single source of truth that SDK consumers (and this repo's own demo client)
// depend on. Bump PRIMITIVE_VERSION for any breaking change to the surface.

import type { BriefSearchResponse } from './types';
import type { LicenseRow, MatchFeedbackRow, LicenseUsageType } from './api-client';
import type { MatchBenchmarkReport } from './match-benchmark';

export const PRIMITIVE_VERSION = 'v1' as const;

// ── brief → ranked matches ─────────────────────────────
export interface PrimitiveMatchRequest {
  brief: string;
  limit?: number;
  offset?: number;
}
export type PrimitiveMatchResponse = BriefSearchResponse;

// ── record ground-truth on a shown match ────────────────
export interface PrimitiveVerdictRequest {
  brief: string;
  briefHash: string; // stable hash of the normalized brief (matchBriefHash)
  submissionId: string; // a take from the match response
  fitScoreShown: number;
  rankShown?: number | null;
  verdict: 'good_fit' | 'wrong_fit';
}
export interface PrimitiveVerdictResponse {
  row: MatchFeedbackRow;
}

// ── open a license for a matched take ──────────────────
export interface PrimitiveLicenseRequest {
  submissionId: string;
  briefHash: string;
  briefText: string;
  usageType: LicenseUsageType; // fee derived server-side from usage
}
export interface PrimitiveLicenseResponse {
  license: LicenseRow;
}

// ── settle a license on Arc (mock-first) ────────────────
export interface PrimitiveSettleResponse {
  license: LicenseRow;
  settled?: { txHash: string; mock: boolean };
}

// ── match-quality report (the ground-truth moat) ────────
export interface PrimitiveBenchmarkResponse {
  report: MatchBenchmarkReport;
}

// Physical endpoints implementing each contract operation. Requests carry
// the operator's identity as `x-supervisor-guest: <id>` (or a connected
// wallet); the response envelope is { success, data, error? }.
export const PRIMITIVE_BASE = '/api/v1' as const;
export const PRIMITIVE_ENDPOINTS = {
  match: '/api/v1/discover/brief',
  verdict: '/api/v1/discover/brief/feedback',
  license: '/api/v1/licenses',
  receipt: (id: string) => `/api/v1/licenses/${encodeURIComponent(id)}`,
  settle: (id: string) => `/api/v1/licenses/${encodeURIComponent(id)}/pay`,
  benchmark: '/api/v1/discover/benchmark',
} as const;