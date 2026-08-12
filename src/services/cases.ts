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
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  placementCases as casesTable,
  caseEvents as caseEventsTable,
  users as usersTable,
  supervisorProfiles as profilesTable,
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
  recommendationText?: string;
}

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
  submissionId: string;
}

export interface DecisionInput {
  supervisorWallet: string;
  caseId: string;
  status?: string;
  clearPending?: boolean;
  note?: string | null;
}

export interface CasesService {
  openCase(input: OpenCaseInput): Promise<PlacementCaseRow>;
  addShortlist(input: AddShortlistInput): Promise<PlacementCaseRow | null>;
  recordDecision(input: DecisionInput): Promise<PlacementCaseRow | null>;
  listCases(wallet: string, opts?: { limit?: number }): Promise<PlacementCaseRow[]>;
  countOpen(wallet: string): Promise<number>;
  getCase(
    wallet: string,
    id: string,
  ): Promise<{ case: PlacementCaseRow; events: CaseEventRow[] } | null>;
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
      // Attach to the supervisor's most recent open case. Discover does
      // not always know which brief produced a row; the latest active
      // case is the correct prospect target for this non-scaling cut.
      const [latest] = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.supervisorWallet, wallet), eq(casesTable.status, "open")))
        .orderBy(desc(casesTable.lastActivity))
        .limit(1);
      if (!latest) return null;

      const evidence = {
        ...(latest.evidence as PlaceCaseEvidence),
        shortlistSubmissionIds: [...((latest.evidence as PlaceCaseEvidence).shortlistSubmissionIds ?? [])],
      };
      if (!evidence.shortlistSubmissionIds.includes(input.submissionId)) {
        evidence.shortlistSubmissionIds.push(input.submissionId);
      }
      const now = new Date();
      const [row] = await db
        .update(casesTable)
        .set({ evidence, lastActivity: now, updatedAt: now })
        .where(eq(casesTable.id, latest.id))
        .returning();
      await db.insert(caseEventsTable).values({
        id: randomUUID(),
        caseId: latest.id,
        kind: "shortlisted",
        detail: { submissionId: input.submissionId },
        createdAt: now,
      });
      return rowToCase(row!);
    },
async recordDecision(input) {
      const wallet = input.supervisorWallet.toLowerCase();
      const [existing] = await db
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.id, input.caseId), eq(casesTable.supervisorWallet, wallet)))
        .limit(1);
      if (!existing) return null;

      const now = new Date();
      const status = input.status ?? (input.clearPending ? "rights_review" : existing.status);
      const plan = (existing.agentPlan as PlaceCaseStep[]).map((s) =>
        s.key === "decision" ? { ...s, done: true, current: false } : s,
      );

      const updates: Partial<typeof casesTable.$inferInsert> = {
        status,
        agentPlan: plan,
        lastActivity: now,
        updatedAt: now,
      };
      if (input.clearPending) updates.pendingDecision = null;
      if (status === "rights_review") updates.objective = "rights review";

      const [row] = await db
        .update(casesTable)
        .set(updates)
        .where(eq(casesTable.id, existing.id))
        .returning();

      if (input.clearPending && existing.pendingDecision) {
        await db.insert(caseEventsTable).values({
          id: randomUUID(),
          caseId: existing.id,
          kind: "decision",
          detail: { status, note: input.note ?? null, cleared: existing.pendingDecision },
          createdAt: now,
        });
        if (status === "rights_review") {
          await db.insert(caseEventsTable).values({
            id: randomUUID(),
            caseId: existing.id,
            kind: "rights_requested",
            detail: {},
            createdAt: now,
          });
        }
      }
      return rowToCase(row!);
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
  };
}