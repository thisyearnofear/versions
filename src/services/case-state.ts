// MODULAR: Pure placement-case state engine, extracted from cases.ts so the
// service focuses on orchestration + persistence while the lifecycle
// projection (brief → agent plan → derived licensing/settlement status) lives
// in one focused, unit-testable module with NO DB coupling. All functions here
// are pure row→shape mappers; every DB read / transition stays in cases.ts.

import { placementCases, licenses, caseEvents } from '../lib/schema';
import type { PlaceCaseStep, PlaceCaseEvidence, PlacementCaseRow, CaseEventRow } from './cases';

// The default step-plan for a freshly-opened case: one explicit human gate,
// rights and settlement kept honest ("can prepare", never "already cleared").
export const DEFAULT_PLAN: PlaceCaseStep[] = [
  { key: "interpret", label: "Interpreted the brief", done: true },
  { key: "rank", label: "Ranked the eligible takes", done: true },
  { key: "recommend", label: "Prepared evidence-backed recommendations", done: false },
  { key: "decision", label: "Needs your judgment", done: false, current: true },
  { key: "rights", label: "Rights review begins once you shortlist", done: false },
  { key: "settle", label: "Settlement after approval", done: false },
];

// Derive a scoped human decision + an evidence-backed recommendation from
// the brief. Honest by design: it refers to REAL ranked candidates and a
// real ranked_count; it never fabricates qualitative claims ("Track A has
// the most dialogue space") or legal authority. In mock mode this is the
// deterministic engine; a live LLM can refine the same fields later.
export function deriveCasePlan(
  brief: string,
  rankedCount: number,
  candidateTitles: string[],
): { pendingDecision: string | null; recommendationText: string } {
  const lower = brief.toLowerCase();
  const scopes: string[] = [];
  if (/no vocal|without vocal|no singing|instrumental/.test(lower)) scopes.push("an instrumental-leaning direction");
  if (/vocals|\bvocal\b|voice|singer/.test(lower)) scopes.push("a vocal-leaning direction");
  const tempo = lower.match(/(\d{2,3})\s*(?:bpm)/);
  if (tempo) scopes.push(`a ${tempo[1]} bpm arrangement`);
  const moods = ["dark", "tense", "dreamy", "gentle", "uplifting", "melancholic", "euphoric", "restrained", "energetic", "warm"].filter((m) =>
    lower.includes(m),
  );
  if (moods.length) scopes.push(`the ${moods.join(" / ")} feel`);
  const scope = scopes.length ? scopes.join(", ") : "the leading creative direction";

  const leads = candidateTitles.slice(0, 3).filter(Boolean);
  const recommendationText =
    rankedCount > 0
      ? `Ranked ${rankedCount} eligible takes. Leading contenders: ${leads.length ? leads.join(", ") : "—"}. Shortlist to begin rights review.`
      : "Interpreted the brief and opened the case. Match ranking returns as the catalog is scored.";

  return {
    pendingDecision: `Choose ${scope} — I’ll shortlist it and prepare the rights-review request`,
    recommendationText,
  };
}

export function rowToCase(
  row: typeof placementCases.$inferSelect,
  latestEvent?: { kind: string; createdAt: Date },
): PlacementCaseRow {
  const evidence = (row.evidence ?? {}) as PlaceCaseEvidence;
  return {
    id: row.id,
    supervisor_wallet: row.supervisorWallet,
    kind: row.kind,
    brief_text: row.briefText,
    status: row.status,
    objective: row.objective,
    pending_decision: row.pendingDecision,
    license_id: row.licenseId ?? null,
    agent_plan: row.agentPlan ?? [],
    evidence,
    ranked_count: evidence.rankedCount ?? 0,
    shortlist_count: (evidence.shortlistSubmissionIds ?? []).length,
    last_activity: row.lastActivity,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    latest_event: latestEvent
      ? { kind: latestEvent.kind, created_at: latestEvent.createdAt }
      : null,
  };
}

export function rowToEvent(row: typeof caseEvents.$inferSelect): CaseEventRow {
  return {
    id: row.id,
    case_id: row.caseId,
    kind: row.kind,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    created_at: row.createdAt,
  };
}

// ── Lifecycle projection ───────────────────────────────
// The case's licensing/settlement state is DERIVED from the authoritative
// license record at read time — never written by a client command. This is
// the single source of truth so a paid license can never be masked by a
// stale case row, and a case can never claim "settled" before the license
// is actually paid.
export function projectStatus(storedStatus: string, licenseStatus: string | null): string {
  if (!licenseStatus) return storedStatus;
  if (licenseStatus === "paid") return "settled";
  if (licenseStatus === "settling") return "settlement_pending";
  return "rights_review"; // license pending_payment => request prepared, not cleared
}

export function planForStatus(
  row: typeof placementCases.$inferSelect,
  status: string,
): PlaceCaseStep[] {
  const hasRecommendation = !!((row.evidence as PlaceCaseEvidence).recommendationText);
  const decisionDone = status !== "open" && status !== "awaiting_decision";
  return [
    { key: "interpret", label: "Interpreted the brief", done: true },
    { key: "rank", label: "Ranked the eligible takes", done: true },
    { key: "recommend", label: "Prepared evidence-backed recommendations", done: hasRecommendation },
    { key: "decision", label: "Needs your judgment", done: decisionDone, current: !decisionDone },
    { key: "rights", label: "Rights review", done: status === "settlement_pending" || status === "settled", current: status === "rights_review" },
    { key: "settle", label: "Settlement", done: status === "settled", current: status === "settlement_pending" },
  ];
}

export function projectedCase(
  row: typeof placementCases.$inferSelect,
  license: typeof licenses.$inferSelect | null,
  latestEvent?: { kind: string; createdAt: Date },
): PlacementCaseRow {
  const status = projectStatus(row.status, license?.status ?? null);
  // A compatible authoritative license means the human decision is made;
  // this also repairs legacy rows whose link write failed after licensing.
  const pendingDecision = license ? null : row.pendingDecision;
  return {
    ...rowToCase(row),
    status,
    pending_decision: pendingDecision,
    license_id: license?.id ?? row.licenseId ?? null,
    agent_plan: planForStatus(row, status),
    latest_event: latestEvent
      ? { kind: latestEvent.kind, created_at: latestEvent.createdAt }
      : null,
  };
}