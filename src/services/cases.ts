// MODULAR: Placement Case service — the persistent work object at
// the heart of the supervisor workspace. A case is the brief + the
// agent's plan + the evidence + the ONE human decision it waits on.
// It survives sessions (leave, return tomorrow, re-read the pending
// decision) and carries a durable, per-case activity trail.
//
// Additive: it anchors onto the existing saved_briefs /
// licensing_interests / licenses rails. Identity keying matches the
// rest of the supervisor tables (wallet, or a derived guest
// pseudo-wallet), so the wallet-free discover journey can open and
// resume a case.

import { randomUUID } from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  placementCases as casesTable,
  caseEvents as caseEventsTable,
  users as usersTable,
  supervisorProfiles as profilesTable,
  licenses as licensesTable,
} from "../lib/schema";

export interface PlaceCaseStep {
  key: string;
  label: string;
  done: boolean;
  current?: boolean;
}

export interface PlaceCaseEvidence {
  rankedCount?: number;
  shortlistSubmissionIds?: string[];
  shortlisted?: CaseShortlistEntry[];
  recommendationText?: string;
}

/** A take the supervisor kept, with the REAL match score + rank shown. */
export interface CaseShortlistEntry {
  submissionId: string;
  fitScore: number;
  rank?: number | null;
}

export interface PlacementCaseRow {
  id: string;
  supervisor_wallet: string;
  kind: string;
  brief_text: string;
  status: string;
  objective: string | null;
  pending_decision: string | null;
  license_id: string | null;
  agent_plan: PlaceCaseStep[];
  evidence: PlaceCaseEvidence;
  ranked_count: number;
  shortlist_count: number;
  last_activity: Date;
  created_at: Date;
  updated_at: Date;
  latest_event?: { kind: string; created_at: Date } | null;
}

export interface CaseEventRow {
  id: string;
  case_id: string;
  kind: string;
  detail: Record<string, unknown>;
  created_at: Date;
}

export interface OpenCaseInput {
  supervisorWallet: string;
  briefText: string;
  rankedCount?: number;
  pendingDecision?: string | null;
  /** Top candidate take titles from the search the supervisor just ran. */
  candidateTitles?: string[];
}

export interface AddShortlistInput {
  supervisorWallet: string;
  /** The explicit case this take belongs to — never "most recently active". */
  caseId: string;
  submissionId: string;
  /** Real match score shown to the supervisor (for shortlist evidence). */
  fitScore?: number;
  rank?: number | null;
}

// ── Server-owned transition commands ────────────────────
// The UI may ASK for a decision; the service decides whether that
// transition is legal. Cases never accept a free-form status string.
export type CaseCommand =
  | { type: "record_creative_decision"; note?: string }
  | { type: "start_rights_review"; licenseId?: string }
  | { type: "mark_settlement_ready" }
  | { type: "record_settlement" };

export type CaseCommandResult =
  | { ok: true; row: PlacementCaseRow }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_OWNED" | "ILLEGAL_TRANSITION" | "INVALID_ARGUMENT";
      message: string;
    };

export interface CasesService {
  openCase(input: OpenCaseInput): Promise<PlacementCaseRow>;
  addShortlist(input: AddShortlistInput): Promise<PlacementCaseRow | null>;
  executeCommand(wallet: string, caseId: string, command: CaseCommand): Promise<CaseCommandResult>;
  listCases(wallet: string, opts?: { limit?: number }): Promise<PlacementCaseRow[]>;
  countOpen(wallet: string): Promise<number>;
  getCase(
    wallet: string,
    id: string,
  ): Promise<{ case: PlacementCaseRow; events: CaseEventRow[] } | null>;
  /** Link a real license to the matching case and enter rights_review. */
  linkLicenseForOutcome(
    wallet: string,
    input: { briefText: string; submissionId: string; licenseId: string },
  ): Promise<PlacementCaseRow | null>;
  /** Find the case that owns a license (for settlement transitions). */
  getCaseByLicense(wallet: string, licenseId: string): Promise<PlacementCaseRow | null>;
}

// The named steps an agent owns on a fresh placement brief. Order and
// language mirror the supervisor narrative: concrete progress first,
// one explicit human gate, rights and settlement kept honest ("can
// prepare", never "already cleared").
const DEFAULT_PLAN: PlaceCaseStep[] = [
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
function deriveCasePlan(
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

export function createCasesService(): CasesService {
  // ensureUser + ensureProfile so a guest pseudo-wallet (or a fresh
  // wallet) can own a case without tripping the FKs. Mirrors the
  // supervisor service pattern.
  async function ensureProfile(wallet: string): Promise<void> {
    const w = wallet.toLowerCase();
    await db
      .insert(usersTable)
      .values({ id: randomUUID(), walletAddress: w, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoNothing({ target: usersTable.walletAddress });
    await db
      .insert(profilesTable)
      .values({
        wallet: w,
        role: "supervisor",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: profilesTable.wallet });
  }

  function rowToCase(
    row: typeof casesTable.$inferSelect,
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

  function rowToEvent(row: typeof caseEventsTable.$inferSelect): CaseEventRow {
    return {
      id: row.id,
      case_id: row.caseId,
      kind: row.kind,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      created_at: row.createdAt,
    };
  }

  return {
    async openCase(input) {
      const wallet = input.supervisorWallet.toLowerCase();
      await ensureProfile(wallet);
      const brief = input.briefText.trim();
      if (brief.length < 1) throw new Error("briefText must not be empty");
      const now = new Date();

      // Reuse an already-open case for the same brief so repeated
      // searches prospect the SAME case instead of littering the board.
      const [existing] = await db
        .select()
        .from(casesTable)
        .where(
          and(
            eq(casesTable.supervisorWallet, wallet),
            eq(casesTable.briefText, brief),
            eq(casesTable.status, "open"),
          ),
        )
        .limit(1);

      const evidence: PlaceCaseEvidence = existing
        ? { ...(existing.evidence as PlaceCaseEvidence) }
        : { shortlistSubmissionIds: [] as string[] };
      if (input.rankedCount != null) evidence.rankedCount = input.rankedCount;

      // Derive a scoped human decision + evidence-backed recommendation. On an
      // open (existing) case we only fill the recommendation if it is still
      // empty, so the supervisor's chosen direction is never overwritten.
      const derived = deriveCasePlan(brief, evidence.rankedCount ?? 0, input.candidateTitles ?? []);
      if (!existing?.evidence || !(existing.evidence as PlaceCaseEvidence).recommendationText) {
        evidence.recommendationText = derived.recommendationText;
      }
      const pendingDecision = existing?.pendingDecision ?? input.pendingDecision ?? derived.pendingDecision;
      const plan: PlaceCaseStep[] = (existing?.agentPlan as PlaceCaseStep[] | undefined) ?? DEFAULT_PLAN;
      const refinedPlan = plan.map((s) =>
        s.key === "recommend" && evidence.recommendationText ? { ...s, done: true, current: false } : s,
      );

      let id = existing?.id;
      if (!id) {
        id = randomUUID();
        await db.insert(casesTable).values({
          id,
          supervisorWallet: wallet,
          kind: "placement",
          briefText: brief,
          status: "open",
          objective: null,
          pendingDecision,
          agentPlan: refinedPlan,
          evidence,
          lastActivity: now,
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(caseEventsTable).values([
          { id: randomUUID(), caseId: id, kind: "case_opened", detail: { briefText: brief }, createdAt: now },
          { id: randomUUID(), caseId: id, kind: "brief_interpreted", detail: {}, createdAt: now },
          {
            id: randomUUID(),
            caseId: id,
            kind: "ranked",
            detail: { rankedCount: evidence.rankedCount ?? 0 },
            createdAt: now,
          },
          {
            id: randomUUID(),
            caseId: id,
            kind: "case_recommended",
            detail: { recommendation: evidence.recommendationText ?? "" },
            createdAt: now,
          },
        ]);
      } else {
        await db
          .update(casesTable)
          .set({ agentPlan: refinedPlan, evidence, pendingDecision, lastActivity: now, updatedAt: now })
          .where(eq(casesTable.id, id));
      }

      const [row] = await db.select().from(casesTable).where(eq(casesTable.id, id)).limit(1);
      return rowToCase(row!);
    },

    async addShortlist(input) {
      const wallet = input.supervisorWallet.toLowerCase();
      await ensureProfile(wallet);
      // Attach to the EXACT case the supervisor acted on. Ownership is
      // checked by scoping on (id, wallet) — never "most recently active".
      const [target] = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.id, input.caseId), eq(casesTable.supervisorWallet, wallet)))
        .limit(1);
      if (!target) return null;

      const evidence = {
        ...(target.evidence as PlaceCaseEvidence),
        shortlistSubmissionIds: [...((target.evidence as PlaceCaseEvidence).shortlistSubmissionIds ?? [])],
      };
      const isNew = !evidence.shortlistSubmissionIds.includes(input.submissionId);
      if (isNew) {
        evidence.shortlistSubmissionIds.push(input.submissionId);
      }
      // Record the REAL per-take match evidence that justified keeping it
      // (fit score + rank as shown) — the case trail stays truthful.
      const shortlisted = [...((target.evidence as PlaceCaseEvidence).shortlisted ?? [])];
      const existingEntry = shortlisted.find((e) => e.submissionId === input.submissionId);
      if (existingEntry) {
        existingEntry.fitScore = input.fitScore ?? existingEntry.fitScore;
        if (input.rank != null) existingEntry.rank = input.rank;
      } else {
        shortlisted.push({ submissionId: input.submissionId, fitScore: input.fitScore ?? 0, rank: input.rank ?? null });
      }
      evidence.shortlisted = shortlisted;
      const now = new Date();
      const [row] = await db
        .update(casesTable)
        .set({ evidence, lastActivity: now, updatedAt: now })
        .where(eq(casesTable.id, target.id))
        .returning();
      if (isNew) {
        await db.insert(caseEventsTable).values({
          id: randomUUID(),
          caseId: target.id,
          kind: "shortlisted",
          detail: { submissionId: input.submissionId, fitScore: input.fitScore ?? null, rank: input.rank ?? null },
          createdAt: now,
        });
      }
      return rowToCase(row!);
    },
async executeCommand(wallet, caseId, command) {
      const w = wallet.toLowerCase();
      const [existing] = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.id, caseId), eq(casesTable.supervisorWallet, w)))
        .limit(1);
      if (!existing) {
        return { ok: false, code: "NOT_FOUND" as const, message: "Case not found." };
      }
      const now = new Date();
      // Transition the owned agent plan: the human decision step completes and
      // the next owned step becomes current.
      const advancePlan = (currentKey: string) =>
        (existing.agentPlan as PlaceCaseStep[]).map((s) =>
          s.key === "decision"
            ? { ...s, done: true, current: false }
            : s.key === "rights" || s.key === "settle"
              ? { ...s, current: s.key === currentKey }
              : s,
        );
      const insertEvent = (kind: string, detail: Record<string, unknown>) =>
        db.insert(caseEventsTable).values({ id: randomUUID(), caseId: existing.id, kind, detail, createdAt: now });

      if (command.type === "record_creative_decision") {
        if (!["open", "awaiting_decision"].includes(existing.status)) {
          return { ok: false, code: "ILLEGAL_TRANSITION" as const, message: `Cannot record a creative decision from status '${existing.status}'` };
        }
        if (!existing.pendingDecision) {
          return { ok: false, code: "INVALID_ARGUMENT" as const, message: "No decision is pending on this case." };
        }
        const [row] = await db
          .update(casesTable)
          .set({
            status: "rights_review",
            pendingDecision: null,
            objective: "rights review",
            agentPlan: advancePlan("rights"),
            lastActivity: now,
            updatedAt: now,
          })
          .where(eq(casesTable.id, existing.id))
          .returning();
        await insertEvent("decision", { cleared: existing.pendingDecision, note: command.note ?? null });
        await insertEvent("rights_prepared", { prepared: true, cleared: false, note: "request + evidence packet prepared; rights are NOT cleared" });
        return { ok: true as const, row: rowToCase(row!) };
      }

      if (command.type === "start_rights_review") {
        if (!["open", "awaiting_decision", "rights_review"].includes(existing.status)) {
          return { ok: false, code: "ILLEGAL_TRANSITION" as const, message: `Cannot start rights review from status '${existing.status}'` };
        }
        let licenseId = existing.licenseId;
        if (command.licenseId) {
          const [lic] = await db
            .select()
            .from(licensesTable)
            .where(and(eq(licensesTable.id, command.licenseId), eq(licensesTable.supervisorWallet, w)))
            .limit(1);
          if (!lic) return { ok: false, code: "INVALID_ARGUMENT" as const, message: "License not found or not owned by this wallet." };
          licenseId = command.licenseId;
        }
        const [row] = await db
          .update(casesTable)
          .set({
            status: "rights_review",
            licenseId: licenseId ?? undefined,
            agentPlan: advancePlan("rights"),
            lastActivity: now,
            updatedAt: now,
          })
          .where(eq(casesTable.id, existing.id))
          .returning();
        await insertEvent("rights_review", { prepared: true, cleared: false, licenseId: licenseId ?? null });
        return { ok: true as const, row: rowToCase(row!) };
      }

      if (command.type === "mark_settlement_ready") {
        if (!["rights_review", "settlement_pending"].includes(existing.status)) {
          return { ok: false, code: "ILLEGAL_TRANSITION" as const, message: `Cannot prepare settlement from status '${existing.status}'` };
        }
        if (!existing.licenseId) {
          return { ok: false, code: "INVALID_ARGUMENT" as const, message: "No license linked to this case; settlement cannot be prepared." };
        }
        const [row] = await db
          .update(casesTable)
          .set({ status: "settlement_pending", agentPlan: advancePlan("settle"), lastActivity: now, updatedAt: now })
          .where(eq(casesTable.id, existing.id))
          .returning();
        await insertEvent("settlement_ready", { licenseId: existing.licenseId, awaitingApproval: true });
        return { ok: true as const, row: rowToCase(row!) };
      }

      if (command.type === "record_settlement") {
        if (existing.status !== "settlement_pending") {
          return { ok: false, code: "ILLEGAL_TRANSITION" as const, message: "Only a settlement-pending case can be settled." };
        }
        if (!existing.licenseId) {
          return { ok: false, code: "INVALID_ARGUMENT" as const, message: "No license linked to this case." };
        }
        const [lic] = await db.select().from(licensesTable).where(eq(licensesTable.id, existing.licenseId)).limit(1);
        if (!lic || lic.status !== "paid") {
          return { ok: false, code: "INVALID_ARGUMENT" as const, message: "The linked license has not been paid; settlement cannot be recorded." };
        }
        const [row] = await db
          .update(casesTable)
          .set({ status: "settled", objective: "settlement recorded", agentPlan: advancePlan("settle"), lastActivity: now, updatedAt: now })
          .where(eq(casesTable.id, existing.id))
          .returning();
        await insertEvent("settled", { licenseId: existing.licenseId, paid: true });
        return { ok: true as const, row: rowToCase(row!) };
      }

      return { ok: false, code: "INVALID_ARGUMENT" as const, message: "Unknown command." };
    },

    async listCases(wallet, { limit = 20 } = {}) {
      const w = wallet.toLowerCase();
      const rows = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.supervisorWallet, w), sql`${casesTable.status} <> 'archived'`))
        .orderBy(desc(casesTable.lastActivity))
        .limit(limit);
      // Attach each case's latest event (bounded N+1; the board caps at 20).
      const withEvents = await Promise.all(
        rows.map(async (r) => {
          const [ev] = await db
            .select()
            .from(caseEventsTable)
            .where(eq(caseEventsTable.caseId, r.id))
            .orderBy(desc(caseEventsTable.createdAt))
            .limit(1);
          return rowToCase(r, ev ?? undefined);
        }),
      );
      return withEvents;
    },

    async countOpen(wallet) {
      const w = wallet.toLowerCase();
      const [row] = await db
        .select({ count: sql<number>`count(*)`.as("cont") })
        .from(casesTable)
        .where(and(eq(casesTable.supervisorWallet, w), eq(casesTable.status, "open")));
      return row?.count ?? 0;
    },

    async getCase(wallet, id) {
      const [row] = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.id, id), eq(casesTable.supervisorWallet, wallet.toLowerCase())))
        .limit(1);
      if (!row) return null;
      const events = await db
        .select()
        .from(caseEventsTable)
        .where(eq(caseEventsTable.caseId, id))
        .orderBy(desc(caseEventsTable.createdAt));
      return { case: rowToCase(row), events: events.map(rowToEvent) };
    },

    async linkLicenseForOutcome(wallet, { briefText, submissionId, licenseId }) {
      const w = wallet.toLowerCase();
      const candidates = await db
        .select()
        .from(casesTable)
        .where(
          and(
            eq(casesTable.supervisorWallet, w),
            sql`${casesTable.status} <> 'archived'`,
            isNull(casesTable.licenseId),
          ),
        )
        .orderBy(desc(casesTable.lastActivity))
        .limit(20);
      // Prefer the exact-brief match; fall back to a case that shortlisted this take.
      const byBrief = candidates.find((c) => c.briefText === briefText);
      const byShortlist = candidates.find((c) =>
        ((c.evidence as PlaceCaseEvidence).shortlistSubmissionIds ?? []).includes(submissionId),
      );
      const target = byBrief ?? byShortlist;
      if (!target) return null;
      if (!["open", "awaiting_decision", "rights_review"].includes(target.status)) return null;

      const plan = (target.agentPlan as PlaceCaseStep[]).map((s) =>
        s.key === "decision"
          ? { ...s, done: true, current: false }
          : s.key === "rights"
            ? { ...s, current: true }
            : s,
      );
      const now = new Date();
      const [row] = await db
        .update(casesTable)
        .set({ licenseId, status: "rights_review", objective: "rights review", agentPlan: plan, lastActivity: now, updatedAt: now })
        .where(eq(casesTable.id, target.id))
        .returning();
      await db.insert(caseEventsTable).values({
        id: randomUUID(),
        caseId: target.id,
        kind: "rights_review",
        detail: { licenseId, prepared: true, cleared: false, note: "license request prepared; rights are NOT cleared" },
        createdAt: now,
      });
      return rowToCase(row!);
    },

    async getCaseByLicense(wallet, licenseId) {
      const [row] = await db
        .select()
        .from(casesTable)
        .where(
          and(
            eq(casesTable.licenseId, licenseId),
            eq(casesTable.supervisorWallet, wallet.toLowerCase()),
          ),
        )
        .limit(1);
      return row ? rowToCase(row) : null;
    },
  };
}