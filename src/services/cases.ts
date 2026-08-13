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
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
// The UI may ASK for a human decision; the service decides whether that is
// legal. Licensing/settlement status is NEVER set by a command — it is
// derived from the authoritative license record at read time (see
// licenseStatusFor / projectedCase). There is deliberately no client path to
// attach a license to an arbitrary case or to mark a case settled.
export type CaseCommand = { type: "record_creative_decision"; note?: string };

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
  /** Link a real license to its matching shortlisted case and enter rights review. */
  linkLicenseForOutcome(wallet: string, input: { licenseId: string }): Promise<PlacementCaseRow | null>;
  /** Find the case that owns a license (for settlement transitions). */
  getCaseByLicense(wallet: string, licenseId: string): Promise<PlacementCaseRow | null>;
  /** Persist a paid license's terminal case projection; safe to retry. */
  reconcileLicenseOutcome(wallet: string, licenseId: string): Promise<PlacementCaseRow | null>;
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

  // ── Lifecycle projection ───────────────────────────────
  // The case's licensing/settlement state is DERIVED from the authoritative
  // license record at read time — never written by a client command. This is
  // the single source of truth so a paid license can never be masked by a
  // stale case row, and a case can never claim "settled" before the license
  // is actually paid.
  function projectStatus(storedStatus: string, licenseStatus: string | null): string {
    if (!licenseStatus) return storedStatus;
    if (licenseStatus === "paid") return "settled";
    if (licenseStatus === "settling") return "settlement_pending";
    return "rights_review"; // license pending_payment => request prepared, not cleared
  }

  function planForStatus(row: typeof casesTable.$inferSelect, status: string): PlaceCaseStep[] {
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

  function projectedCase(
    row: typeof casesTable.$inferSelect,
    license: typeof licensesTable.$inferSelect | null,
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

  // Authoritative license state for a case. Uses the stored link when present,
  // otherwise READ-REPAIRS: finds an owned license whose submission is in this
  // case's shortlist and whose brief matches — so a failed fire-and-forget link
  // can never strand a paid license or a stale case.
  async function licenseStatusFor(
    wallet: string,
    row: typeof casesTable.$inferSelect,
  ): Promise<typeof licensesTable.$inferSelect | null> {
    if (row.licenseId) {
      const [lic] = await db
        .select()
        .from(licensesTable)
        .where(and(eq(licensesTable.id, row.licenseId), eq(licensesTable.supervisorWallet, wallet.toLowerCase())))
        .limit(1);
      return lic ?? null;
    }
    const shortlist = (row.evidence as PlaceCaseEvidence).shortlistSubmissionIds ?? [];
    if (shortlist.length === 0) return null;
    const [lic] = await db
      .select()
      .from(licensesTable)
      .where(
        and(
          eq(licensesTable.supervisorWallet, wallet.toLowerCase()),
          eq(licensesTable.briefText, row.briefText),
          inArray(licensesTable.submissionId, shortlist),
        ),
      )
      .orderBy(desc(licensesTable.createdAt))
      .limit(1);
    return lic ?? null;
  }

  async function reconcileSettledCaseForBrief(wallet: string, briefText: string): Promise<void> {
    const [row] = await db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.supervisorWallet, wallet),
          eq(casesTable.briefText, briefText),
          sql`${casesTable.status} NOT IN ('settled', 'archived')`,
        ),
      )
      .limit(1);
    if (!row) return;
    const license = await licenseStatusFor(wallet, row);
    if (license?.status !== "paid") return;

    const now = new Date();
    const [settled] = await db
      .update(casesTable)
      .set({
        licenseId: license.id,
        status: "settled",
        pendingDecision: null,
        objective: "settlement recorded",
        agentPlan: planForStatus(row, "settled"),
        lastActivity: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(casesTable.id, row.id),
          sql`${casesTable.status} <> 'settled'`,
          or(isNull(casesTable.licenseId), eq(casesTable.licenseId, license.id)),
        ),
      )
      .returning();
    if (settled) {
      await db.insert(caseEventsTable).values({
        id: randomUUID(),
        caseId: settled.id,
        kind: "settled",
        detail: { licenseId: license.id, paid: true },
        createdAt: now,
      });
    }
  }

  return {
    async openCase(input) {
      const wallet = input.supervisorWallet.toLowerCase();
      await ensureProfile(wallet);
      const brief = input.briefText.trim();
      if (brief.length < 1) throw new Error("briefText must not be empty");
      // If a prior payment succeeded while its case projection was interrupted,
      // terminalize it before the active-case constraint decides whether this is
      // a resume or a genuinely renewed brief.
      await reconcileSettledCaseForBrief(wallet, brief);
      const now = new Date();

      // Race-safe open: the partial unique index uq_placement_cases_active_brief
      // guarantees at most ONE non-terminal case per (supervisor, brief), so two
      // concurrent identical searches cannot create duplicates. We always attempt
      // the insert with onConflictDoNothing() and then read the single active row.
      const derived = deriveCasePlan(brief, input.rankedCount ?? 0, input.candidateTitles ?? []);
      const inserted = await db
        .insert(casesTable)
        .values({
          id: randomUUID(),
          supervisorWallet: wallet,
          kind: "placement",
          briefText: brief,
          status: "open",
          objective: null,
          pendingDecision: input.pendingDecision ?? derived.pendingDecision,
          agentPlan: DEFAULT_PLAN,
          evidence: {
            shortlistSubmissionIds: [],
            ...(input.rankedCount != null ? { rankedCount: input.rankedCount } : {}),
            recommendationText: derived.recommendationText,
          },
          lastActivity: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      const isNew = inserted.length > 0;

      const [row] = await db
        .select()
        .from(casesTable)
        .where(
          and(
            eq(casesTable.supervisorWallet, wallet),
            eq(casesTable.briefText, brief),
            sql`${casesTable.status} NOT IN ('settled', 'archived')`,
          ),
        )
        .limit(1);
      if (!row) throw new Error("case row missing after open");

      // Merge fresh search signal onto the retained case (never overwrite the
      // supervisor's chosen direction or an existing recommendation).
      const evidence: PlaceCaseEvidence = { ...(row.evidence as PlaceCaseEvidence) };
      if (input.rankedCount != null) evidence.rankedCount = input.rankedCount;
      if (!evidence.recommendationText) evidence.recommendationText = derived.recommendationText;
      const pendingDecision = row.pendingDecision ?? input.pendingDecision ?? derived.pendingDecision;
      await db
        .update(casesTable)
        .set({ evidence, pendingDecision, lastActivity: now, updatedAt: now })
        .where(eq(casesTable.id, row.id));

      if (isNew) {
        await db.insert(caseEventsTable).values([
          { id: randomUUID(), caseId: row.id, kind: "case_opened", detail: { briefText: brief }, createdAt: now },
          { id: randomUUID(), caseId: row.id, kind: "brief_interpreted", detail: {}, createdAt: now },
          { id: randomUUID(), caseId: row.id, kind: "ranked", detail: { rankedCount: evidence.rankedCount ?? 0 }, createdAt: now },
          { id: randomUUID(), caseId: row.id, kind: "case_recommended", detail: { recommendation: evidence.recommendationText ?? "" }, createdAt: now },
        ]);
      }

      return projectedCase(row, null);
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
      // The ONLY client-legal transition is recording the human creative
      // decision. Licensing/settlement are derived from the authoritative
      // license at read time — there is deliberately no command for them.
      if (command.type !== "record_creative_decision") {
        return { ok: false, code: "INVALID_ARGUMENT" as const, message: "Unknown command." };
      }
      if (!["open", "awaiting_decision"].includes(existing.status)) {
        return { ok: false, code: "ILLEGAL_TRANSITION" as const, message: `Cannot record a creative decision from status '${existing.status}'` };
      }
      if (!existing.pendingDecision) {
        return { ok: false, code: "INVALID_ARGUMENT" as const, message: "No decision is pending on this case." };
      }
      const now = new Date();
      const [row] = await db
        .update(casesTable)
        .set({
          status: "rights_review",
          pendingDecision: null,
          objective: "rights review",
          agentPlan: planForStatus(existing, "rights_review"),
          lastActivity: now,
          updatedAt: now,
        })
        .where(eq(casesTable.id, existing.id))
        .returning();
      await db.insert(caseEventsTable).values([
        { id: randomUUID(), caseId: existing.id, kind: "decision", detail: { cleared: existing.pendingDecision, note: command.note ?? null }, createdAt: now },
        { id: randomUUID(), caseId: existing.id, kind: "rights_prepared", detail: { prepared: true, cleared: false, note: "request + evidence packet prepared; rights are NOT cleared" }, createdAt: now },
      ]);
      return { ok: true as const, row: projectedCase(row!, null) };
    },

    async listCases(wallet, { limit = 20 } = {}) {
      const w = wallet.toLowerCase();
      const rows = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.supervisorWallet, w), sql`${casesTable.status} <> 'archived'`))
        .orderBy(desc(casesTable.lastActivity))
        .limit(limit);
      // Attach each case's latest event + projected license state (N+1; ≤20).
      const withEvents = await Promise.all(
        rows.map(async (r) => {
          const [ev] = await db
            .select()
            .from(caseEventsTable)
            .where(eq(caseEventsTable.caseId, r.id))
            .orderBy(desc(caseEventsTable.createdAt))
            .limit(1);
          const licStatus = await licenseStatusFor(w, r);
          return projectedCase(r, licStatus, ev ?? undefined);
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
      const licStatus = await licenseStatusFor(wallet.toLowerCase(), row);
      return { case: projectedCase(row, licStatus), events: events.map(rowToEvent) };
    },

    async linkLicenseForOutcome(wallet, { licenseId }) {
      const w = wallet.toLowerCase();

      // This is a server-only association. Read the license inside the
      // transaction and derive the candidate from its persisted fields—not
      // route input—so an owned license cannot be attached to an unrelated
      // case by supplying a different brief or submission id.
      return db.transaction(async (tx) => {
        const [lic] = await tx
          .select()
          .from(licensesTable)
          .where(and(eq(licensesTable.id, licenseId), eq(licensesTable.supervisorWallet, w)))
          .limit(1);
        if (!lic) return null;

        const candidates = await tx
          .select()
          .from(casesTable)
          .where(
            and(
              eq(casesTable.supervisorWallet, w),
              eq(casesTable.briefText, lic.briefText),
              sql`${casesTable.status} <> 'archived'`,
              isNull(casesTable.licenseId),
            ),
          )
          .orderBy(desc(casesTable.lastActivity))
          .limit(20);
        const target = candidates.find((candidate) => {
          const shortlist = (candidate.evidence as PlaceCaseEvidence).shortlistSubmissionIds ?? [];
          return candidate.briefText === lic.briefText && shortlist.includes(lic.submissionId);
        });
        if (!target || !["open", "awaiting_decision", "rights_review"].includes(target.status)) return null;

        const now = new Date();
        const [row] = await tx
          .update(casesTable)
          .set({
            licenseId,
            status: "rights_review",
            pendingDecision: null,
            objective: "rights review",
            agentPlan: planForStatus(target, "rights_review"),
            lastActivity: now,
            updatedAt: now,
          })
          .where(and(eq(casesTable.id, target.id), isNull(casesTable.licenseId)))
          .returning();
        if (!row) return null;

        await tx.insert(caseEventsTable).values({
          id: randomUUID(),
          caseId: target.id,
          kind: "rights_review",
          detail: {
            licenseId,
            submissionId: lic.submissionId,
            prepared: true,
            cleared: false,
            note: "license request prepared; rights are NOT cleared",
          },
          createdAt: now,
        });
        return projectedCase(row, lic);
      });
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

    async reconcileLicenseOutcome(wallet, licenseId) {
      const w = wallet.toLowerCase();
      return db.transaction(async (tx) => {
        const [license] = await tx
          .select()
          .from(licensesTable)
          .where(and(eq(licensesTable.id, licenseId), eq(licensesTable.supervisorWallet, w)))
          .limit(1);
        if (!license) return null;

        const candidates = await tx
          .select()
          .from(casesTable)
          .where(
            and(
              eq(casesTable.supervisorWallet, w),
              sql`${casesTable.status} <> 'archived'`,
              or(
                eq(casesTable.licenseId, license.id),
                and(isNull(casesTable.licenseId), eq(casesTable.briefText, license.briefText)),
              ),
            ),
          )
          .orderBy(desc(casesTable.lastActivity))
          .limit(20);
        const target = candidates.find((candidate) => {
          if (candidate.licenseId === license.id) return true;
          const shortlist = (candidate.evidence as PlaceCaseEvidence).shortlistSubmissionIds ?? [];
          return candidate.briefText === license.briefText && shortlist.includes(license.submissionId);
        });
        if (!target) return null;
        if (license.status !== "paid") return projectedCase(target, license);
        if (target.status === "settled") return projectedCase(target, license);

        const now = new Date();
        const [settled] = await tx
          .update(casesTable)
          .set({
            licenseId: license.id,
            status: "settled",
            pendingDecision: null,
            objective: "settlement recorded",
            agentPlan: planForStatus(target, "settled"),
            lastActivity: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(casesTable.id, target.id),
              sql`${casesTable.status} <> 'settled'`,
              or(isNull(casesTable.licenseId), eq(casesTable.licenseId, license.id)),
            ),
          )
          .returning();
        if (!settled) return null;
        await tx.insert(caseEventsTable).values({
          id: randomUUID(),
          caseId: settled.id,
          kind: "settled",
          detail: { licenseId: license.id, paid: true },
          createdAt: now,
        });
        return projectedCase(settled, license);
      });
    },
  };
}