"use client";

// MODULAR: single Placement Case detail. The durable record of what the
// agent did for THIS brief — the full activity trail — plus the compose
// surface for the human decision. This is the "leave, return, re-read
// what's waiting on you" view that a marketplace screen never provided.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type PlacementCaseRow, type CaseEventRow } from "@/lib/api-client";
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

export function CaseDetailView({ id }: { id: string }) {
  const { showToast } = useToast();
  const [record, setRecord] = useState<{ case: PlacementCaseRow; events: CaseEventRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecord(await apiClient.getCase(id));
    } catch (err) {
      showToast(`Case load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  // Load on mount. State is only written inside async promise callbacks,
  // never synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getCase(id)
      .then((res) => {
        if (!cancelled) setRecord(res);
      })
      .catch((err) => {
        if (!cancelled) showToast(`Case load failed: ${(err as Error).message}`, "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, showToast]);

  const onDecide = async () => {
    setDeciding(true);
    try {
      await apiClient.recordCaseDecision(id, {
        type: "record_creative_decision" as const,
        note: note.trim() || "Creative direction chosen",
      });
      showToast("Decision recorded — case advanced to rights review", "success");
      setNote("");
      await load();
    } catch (err) {
      showToast(`Decision failed: ${(err as Error).message}`, "error");
    } finally {
      setDeciding(false);
    }
  };

  if (loading) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        Loading case…
      </p>
    );
  }
  if (!record) {
    return (
      <div className="border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-5">
        <Eyebrow className="mb-1 text-[var(--color-rust)]">Case not found</Eyebrow>
        <p className="font-serif text-sm text-[var(--color-ink-2)]">
          You don&apos;t have access to this case, or it has been archived. Open a brief in Discover to start a new case.
        </p>
        <Link
          href="/discover"
          className="mt-4 inline-block bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.14em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors"
        >
          New brief →
        </Link>
      </div>
    );
  }

  const c = record.case;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em]">
            <span className="text-[var(--color-rust)]">{c.kind}</span>
            <span className="text-[var(--color-ink-3)]">·</span>
            <span className="text-[var(--color-ink-3)]">{STATUS_LABEL[c.status] ?? c.status}</span>
            <span className="text-[var(--color-ink-3)]">·</span>
            <span className="text-[var(--color-ink-3)]">
              {c.ranked_count} ranked · {c.shortlist_count} shortlisted
            </span>
            {c.license_id && (
              <>
                <span className="text-[var(--color-ink-3)]">·</span>
                <span className="text-[var(--color-rust)]">license linked</span>
              </>
            )}
          </div>
          <h2 className="mt-1 font-serif text-2xl font-black leading-tight text-[var(--color-ink)]">
            {c.brief_text}
          </h2>
          {c.evidence?.recommendationText && (
            <p className="mt-2 max-w-2xl font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
              {c.evidence.recommendationText}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/discover?brief=${encodeURIComponent(c.brief_text)}`}
            className="font-mono text-[10px] uppercase tracking-[0.12em] border border-[var(--color-ink)] px-3 py-2 text-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
          >
            Resume in Discover →
          </Link>
          <Link
            href="/supervisor"
            className="font-mono text-[10px] uppercase tracking-[0.12em] border border-[var(--color-ink)] px-3 py-2 text-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
          >
            Workspace
          </Link>
        </div>
      </div>
      {c.pending_decision && (
        <Card className="p-4">
          <Eyebrow className="mb-2 text-[var(--color-rust)]">Needs your judgment</Eyebrow>
          <p className="font-serif text-base text-[var(--color-ink)]">{c.pending_decision}</p>
          {c.status === "open" && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Optional — what did you decide and why?"
                className="flex-1 resize-none bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-2 font-serif text-sm"
              />
              <button
                type="button"
                onClick={() => void onDecide()}
                disabled={deciding}
                className="shrink-0 bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
              >
                {deciding ? "…" : "Record decision →"}
              </button>
            </div>
          )}
        </Card>
      )}

      <Section eyebrow="Agent plan" title="Progress" divider={false} className="py-0">
        <ul className="flex flex-col gap-1.5">
          {c.agent_plan.map((s) => (
            <li key={s.key} className="flex items-center gap-2 font-mono text-[11px]">
              <span
                aria-hidden="true"
                className={s.done ? "text-[var(--color-rust)]" : s.current ? "text-[var(--color-rust)]" : "text-[var(--color-ink-3)]"}
              >
                {s.done ? "✓" : s.current ? "!" : "○"}
              </span>
              <span className={s.done ? "text-[var(--color-ink-2)]" : s.current ? "text-[var(--color-ink)] font-medium" : "text-[var(--color-ink-3)]"}>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {c.evidence?.shortlisted && c.evidence.shortlisted.length > 0 && (
        <Section eyebrow="Shortlist evidence" title="Why these made the shortlist" divider={false} className="py-0">
          <ul className="flex flex-col gap-1.5">
            {c.evidence.shortlisted.map((entry) => (
              <li key={entry.submissionId} className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-[var(--color-rust)]">✓</span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink-2)]">
                  {entry.submissionId}
                </span>
                <span className="shrink-0 text-[var(--color-ink-3)]">
                  match {entry.fitScore.toFixed(2)}
                  {entry.rank != null && ` · rank #${entry.rank}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section eyebrow="Activity trail" title="What the agent did" divider={false} className="py-0">
        {record.events.length === 0 ? (
          <p className="font-serif italic text-[var(--color-ink-3)] text-sm">No events recorded yet.</p>
        ) : (
          <ol className="flex flex-col">
            {record.events.map((ev, i) => (
              <li key={ev.id} className="flex items-start gap-3 border-t border-[var(--color-hair)] py-2 first:border-t-0">
                <span className="font-mono text-[9px] text-[var(--color-ink-3)] mt-0.5">
                  {String(record.events.length - i).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">
                    {ev.kind.replace(/_/g, " ")}
                  </p>
                  {Object.keys(ev.detail).length > 0 && (
                    <p className="mt-0.5 font-mono text-[9px] text-[var(--color-ink-3)] break-words">
                      {JSON.stringify(ev.detail)}
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-[9px] text-[var(--color-ink-3)]">
                    {new Date(ev.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}