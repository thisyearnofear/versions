"use client";

// MODULAR: the persistent Placement Case decision board for the
// Workspace. Lists the supervisor's open cases as durable work
// objects — each shows the brief, the agent-owned progress, the ONE
// human decision it is waiting on, and a resume path. This is the
// "leave, return tomorrow, see what's waiting on you" surface that a
// marketplace screen never had.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type PlacementCaseRow } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Card, Eyebrow, Section } from "@/components/ui/primitives";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  awaiting_decision: "Awaiting decision",
  rights_review: "Rights review",
  settlement_ready: "Settlement ready",
  settled: "Settled",
  archived: "Archived",
};

export function PlacementCasesPanel() {
  const { showToast } = useToast();
  const [cases, setCases] = useState<PlacementCaseRow[]>([]);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.getCases({ limit: 20 });
      setCases(res.rows);
      setOpen(res.open);
    } catch (err) {
      showToast(`Cases load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Load on mount. State is only written inside async promise callbacks —
  // never synchronously in the effect body — so it stays clear of the
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getCases({ limit: 20 })
      .then((res) => {
        if (cancelled) return;
        setCases(res.rows);
        setOpen(res.open);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onDecide = async (c: PlacementCaseRow) => {
    setDecidingId(c.id);
    try {
      await apiClient.recordCaseDecision(c.id, {
        clearPending: true,
        status: "rights_review",
        note: "Creative direction chosen — advancing to rights review",
      });
      showToast("Decision recorded — case advanced to rights review", "success");
      await load();
    } catch (err) {
      showToast(`Decision failed: ${(err as Error).message}`, "error");
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <Section
      eyebrow="Your cases"
      title={open > 0 ? `${open} open decision${open === 1 ? "" : "s"}` : "Decision board"}
      intro="Cases the agent is working and the one human decision each is waiting on. The work survives — return whenever you're ready."
      divider={false}
      className="order-0 py-6"
    >
      {loading ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Loading…
        </p>
      ) : cases.length === 0 ? (
        <EmptyBoard />
      ) : (
        <ul className="flex flex-col gap-3">
          {cases.map((c) => (
            <li key={c.id}>
              <Card className="p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-rust)]">
                          {c.kind} · {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                          {c.ranked_count} ranked · {c.shortlist_count} shortlisted
                        </span>
                      </div>
                      <p className="mt-1 font-serif text-[15px] font-medium leading-snug text-[var(--color-ink)]">
                        {c.brief_text}
                      </p>
                      {c.evidence?.recommendationText && (
                        <p className="mt-1.5 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                          {c.evidence.recommendationText}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/discover?brief=${encodeURIComponent(c.brief_text)}`}
                      className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] border border-[var(--color-ink)] px-3 py-1.5 text-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
                    >
                      Resume →
                    </Link>
                  </div>
{c.pending_decision && (
                    <div className="border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <p className="font-serif text-sm text-[var(--color-ink)]">
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-rust)]">
                          Needs your judgment —
                        </span>{" "}
                        {c.pending_decision}
                      </p>
                      <button
                        type="button"
                        onClick={() => void onDecide(c)}
                        disabled={decidingId === c.id}
                        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] bg-[var(--color-ink)] text-[var(--color-paper)] px-3 py-1.5 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
                      >
                        {decidingId === c.id ? "…" : "I've decided"}
                      </button>
                    </div>
                  )}

                  {c.agent_plan && c.agent_plan.length > 0 && (
                    <ul className="flex flex-col gap-1.5">
                      {c.agent_plan.map((s) => (
                        <li key={s.key} className="flex items-center gap-2 font-mono text-[10px]">
                          <span
                            aria-hidden="true"
                            className={
                              s.done
                                ? "text-[var(--color-rust)]"
                                : s.current
                                  ? "text-[var(--color-rust)]"
                                  : "text-[var(--color-ink-3)]"
                            }
                          >
                            {s.done ? "✓" : s.current ? "!" : "○"}
                          </span>
                          <span
                            className={
                              s.done
                                ? "text-[var(--color-ink-2)]"
                                : s.current
                                  ? "text-[var(--color-ink)] font-medium"
                                  : "text-[var(--color-ink-3)]"
                            }
                          >
                            {s.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {c.latest_event && (
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                      Last: {c.latest_event.kind.replace(/_/g, " ")} ·{" "}
                      {new Date(c.latest_event.created_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function EmptyBoard() {
  return (
    <div className="border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-5 flex flex-col gap-3">
      <div>
        <Eyebrow className="mb-1 text-[var(--color-rust)]">No open cases yet</Eyebrow>
        <p className="font-serif text-sm text-[var(--color-ink-2)]">
          Describe a scene in plain English and VERSIONS opens a case, does the legwork, and brings
          you the decisions that need you — here, waiting.
        </p>
      </div>
      <Link
        href="/discover"
        className="self-start bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.14em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors"
      >
        Start a brief →
      </Link>
    </div>
  );
}