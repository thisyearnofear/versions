// MODULAR: Release Case service — an ARTIST's root job. Owned by the artist
// wallet and hard-linked to the real submission_id. The submission record is
// the authoritative source of truth: the release case's visual state is
// ALWAYS re-derived from the linked submission's status, so it can never
// drift from payment/curation reality. No inferred metadata is claimed
// unless it is actually persisted (belief + source) — Slice A only mirrors
// fields the submission already holds.

import { randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import {
  releaseCases as rcTable,
  submissions as submissionsTable,
  type ReleaseCaseStep,
} from "../lib/schema";

export interface ReleaseCaseRow {
  id: string;
  artist_wallet: string;
  submission_id: string;
  title: string;
  artist_name: string;
  version_type: string | null;
  cover_svg: string | null;
  submission_status: string;
  agent_plan: ReleaseCaseStep[];
  last_activity: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ReleaseCasesService {
  /** Idempotently open/refresh the release case for a submission. */
  ensureForSubmission(input: { artistWallet: string; submissionId: string }): Promise<ReleaseCaseRow>;
  /** The artist's active release cases, re-derived from live submission status. */
  getCasesForArtist(artistWallet: string, opts?: { limit?: number }): Promise<ReleaseCaseRow[]>;
}

// The release agent's owned steps. Which step is "current" is derived from the
// linked submission's status each time we read it.
const RELEASE_STEP_SEQUENCE: Array<{ key: string; label: string }> = [
  { key: "record", label: "Release record drafted" },
  { key: "payment", label: "Payment verified" },
  { key: "curation", label: "In curation" },
  { key: "outcome", label: "Published" },
];

function releasePlan(submissionStatus: string): ReleaseCaseStep[] {
  return RELEASE_STEP_SEQUENCE.map((s) => {
    let done = false;
    let current = false;
    switch (submissionStatus) {
      case "pending_payment":
        if (s.key === "record") done = true;
        if (s.key === "payment") current = true;
        break;
      case "awaiting_curation":
      case "in_curation":
        if (s.key === "record" || s.key === "payment") done = true;
        if (s.key === "curation") current = true;
        break;
      case "published":
        done = true;
        if (s.key === "outcome") current = true;
        break;
      case "rejected":
        if (s.key === "record" || s.key === "payment" || s.key === "curation") done = true;
        break;
      default:
        if (s.key === "record") done = true;
        if (s.key === "payment") current = true;
    }
    return { key: s.key, label: s.label, done, current };
  });
}

export function createReleaseCasesService(): ReleaseCasesService {
  function rowToReleaseCase(row: typeof rcTable.$inferSelect): ReleaseCaseRow {
    return {
      id: row.id,
      artist_wallet: row.artistWallet,
      submission_id: row.submissionId,
      title: row.title,
      artist_name: row.artistName,
      version_type: row.versionType,
      cover_svg: row.coverSvg,
      submission_status: row.submissionStatus,
      agent_plan: row.agentPlan ?? releasePlan(row.submissionStatus),
      last_activity: row.lastActivity,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  const service: ReleaseCasesService = {
    async ensureForSubmission({ artistWallet, submissionId }) {
      const wallet = artistWallet.toLowerCase();
      const [sub] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);
      if (!sub) throw new Error("submission not found: " + submissionId);
      if (sub.artistWallet.toLowerCase() !== wallet) {
        throw new Error("submission does not belong to artist: " + submissionId);
      }

      const status = sub.status ?? "pending_payment";
      const plan = releasePlan(status);
      const now = new Date();
      const [row] = await db
        .insert(rcTable)
        .values({
          id: randomUUID(),
          artistWallet: wallet,
          submissionId,
          title: sub.title,
          artistName: sub.artistName,
          versionType: sub.versionType,
          coverSvg: sub.coverSvg,
          submissionStatus: status,
          agentPlan: plan,
          lastActivity: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: rcTable.submissionId,
          set: {
            artistWallet: wallet,
            title: sub.title,
            artistName: sub.artistName,
            versionType: sub.versionType,
            coverSvg: sub.coverSvg,
            submissionStatus: status,
            agentPlan: plan,
            lastActivity: now,
            updatedAt: now,
          },
        })
        .returning();
      return rowToReleaseCase(row!);
    },

    async getCasesForArtist(artistWallet, { limit = 50 } = {}) {
      const w = artistWallet.toLowerCase();

      // Read-repair is the durable recovery path for submissions created
      // before release cases existed or after a transient write failure. It is
      // bounded by the requested page size and idempotent on submission_id.
      const liveSubmissions = await db
        .select({ id: submissionsTable.id })
        .from(submissionsTable)
        .where(and(eq(submissionsTable.artistWallet, w), isNull(submissionsTable.deletedAt)))
        .orderBy(desc(submissionsTable.submittedAt))
        .limit(limit);
      await Promise.all(
        liveSubmissions.map(({ id }) => service.ensureForSubmission({ artistWallet: w, submissionId: id })),
      );

      const rows = await db
        .select({
          rc: rcTable,
          status: submissionsTable.status,
        })
        .from(rcTable)
        .leftJoin(submissionsTable, eq(rcTable.submissionId, submissionsTable.id))
        .where(eq(rcTable.artistWallet, w))
        .orderBy(desc(rcTable.lastActivity))
        .limit(limit);

      // Re-derive the plan from LIVE submission status — the case can never
      // claim a state the submission hasn't actually reached.
      return rows.map(({ rc, status }) =>
        rowToReleaseCase({
          ...rc,
          submissionStatus: status ?? rc.submissionStatus,
          agentPlan: releasePlan(status ?? rc.submissionStatus),
        }),
      );
    },
  };

  return service;
}