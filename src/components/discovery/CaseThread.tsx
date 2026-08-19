"use client";

// MODULAR: Case thread — the placement case rendered as a compact
// conversation instead of a separate page. The brief is the opening
// message; every durable case event (interpreted, ranked, recommended,
// shortlisted, decision, rights, settled) is an agent reply. Refinements
// re-run the search inside the SAME case (keyed on the base brief), so
// the thread is the continuous surface the supervisor never leaves.
//
// COMPACT: collapsed to a single status line; expands into the thread.
// While expanded it polls gently (10s) so async transitions — license
// settlement on Arc — appear in-thread without a refresh.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { apiClient, type CaseEventRow, type PlacementCaseRow } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// MODULAR: event kind → agent voice. One line each, no paragraphs.
// Unknown kinds fall back to a cleaned-up label so new server events
// never render as raw JSON.
function eventMessage(ev: CaseEventRow): string {
  const d = ev.detail ?? {};
  switch (ev.kind) {
    case "case_opened":
      return "Case opened for this brief.";
    case "brief_interpreted":
      return "Brief interpreted — matching on scene, instrumentation, and emotional arc.";
    case "ranked": {
      const n = typeof d.rankedCount === "number" ? d.rankedCount : null;
      return n !== null ? `Ranked ${n} takes by fit.` : "Ranked the catalog by fit.";
    }
    case "case_recommended": {
      const rec = typeof d.recommendation === "string" ? d.recommendation : "";
      return rec ? `Recommendation: ${rec}` : "Top pick named.";
    }
    case "shortlisted": {
      const id = typeof d.submissionId === "string" ? d.submissionId : "";
      const rank = typeof d.rank === "number" ? ` (rank #${d.rank})` : "";
      return id ? `Shortlisted ${id.slice(0, 24)}${rank}.` : "Take shortlisted.";
    }
    case "decision":
      return "Your decision is recorded — advancing to rights review.";
    case "rights_prepared":
      return "Rights packet prepared. Clearance is still required before the license is confirmed.";
    case "rights_review":
      return "Rights review started.";
    case "settled":
      return "Settled on Arc — the royalty waterfall has split.";
    default:
      return ev.kind.replace(/_/g, " ");
  }
}

const STATUS_LABEL: Record<string, string> = {
  open: "open",
  awaiting_decision: "awaiting your decision",
  rights_review: "rights review",
  settlement_pending: "settlement pending",
  settled: "settled",
  archived: "archived",
};

export function CaseThread({
  caseId,
  briefText,
  refreshKey,
}: {
  caseId: string;
  briefText: string;
  // Bumped by the parent after search / shortlist / license actions so
  // the thread re-fetches without the user leaving the page.
  refreshKey: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [record, setRecord] = useState<{ case: PlacementCaseRow; events: CaseEventRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // MODULAR: fetch helper that only writes state inside promise
  // callbacks (never synchronously in an effect body — lint rule).
  const fetchInto = useCallback((cancelled: { current: boolean }) => {
    apiClient
      .getCase(caseId)
      .then((res) => {
        if (!cancelled.current) {
          setRecord(res);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled.current) setFailed(true);
      });
  }, [caseId]);

  // Fetch on mount, on case change, and whenever the parent bumps the
  // refresh key (search completed, shortlist added, license opened).
  useEffect(() => {
    const cancelled = { current: false };
    fetchInto(cancelled);
    return () => {
      cancelled.current = true;
    };
  }, [fetchInto, refreshKey]);

  // While expanded, poll gently so async transitions (settlement) land
  // in-thread. Cleared on collapse / unmount.
  useEffect(() => {
    if (!expanded) return;
    const cancelled = { current: false };
    timerRef.current = setInterval(() => fetchInto(cancelled), 10_000);
    return () => {
      cancelled.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [expanded, fetchInto]);

  if (failed && !record) return null;

  const c = record?.case;
  const events = record?.events ?? [];
  const statusLabel = c ? (STATUS_LABEL[c.status] ?? c.status) : "opening…";

  return (
    <section
      className="mb-4 border border-[var(--color-hair)] rounded-sm bg-[var(--color-paper)] overflow-hidden"
      aria-label="Case thread"
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--color-paper-2)] transition-colors"
      >
        <span className="text-[9px] leading-none text-[var(--color-rust)]" aria-hidden="true">◆</span>
        <span className="flex-1 min-w-0 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-2)] truncate">
          Case {statusLabel}
          {c && ` · ${c.ranked_count} ranked · ${c.shortlist_count} shortlisted`}
          {c?.license_id && " · license linked"}
        </span>
        <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {expanded ? "Hide thread" : "Thread"}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={cn("shrink-0 text-[var(--color-ink-3)] transition-transform", expanded && "rotate-90")}
          aria-hidden
        >
          <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ol className="border-t border-[var(--color-hair)] px-3 py-2.5 space-y-2" aria-label="Case conversation">
              {/* The brief — the supervisor's opening message */}
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] w-12">You</span>
                <p className="min-w-0 font-serif text-[13px] leading-snug text-[var(--color-ink)]">{briefText}</p>
              </li>
              {/* Agent replies — chronological, one line each */}
              {events.length === 0 && (
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--color-rust)] w-12">Agent</span>
                  <p className="font-serif text-[13px] italic text-[var(--color-ink-3)]">Working…</p>
                </li>
              )}
              {[...events].reverse().map((ev) => (
                <li key={ev.id} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--color-rust)] w-12">Agent</span>
                  <p className="min-w-0 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                    {eventMessage(ev)}
                  </p>
                </li>
              ))}
              {/* The pending decision — the one thing waiting on the human */}
              {c?.pending_decision && c.status === "open" && (
                <li className="flex items-start gap-2 border-t border-[var(--color-hair)] pt-2">
                  <span className="mt-0.5 shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--color-rust)] w-12">Agent</span>
                  <p className="min-w-0 font-serif text-[13px] leading-snug text-[var(--color-ink)]">
                    Needs your judgment: {c.pending_decision}
                  </p>
                </li>
              )}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
