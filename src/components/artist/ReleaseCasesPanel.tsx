"use client";

// MODULAR: the artist's active Release Cases — the durable view of what
// their Release Agent is doing with each submitted take. Re-derived from
// the linked submission, so the panel can never claim a state payment /
// curation hasn't actually reached.

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type ReleaseCaseRow, type ReleaseCaseStep } from "@/lib/api-client";
import { Eyebrow } from "@/components/ui/primitives";

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment pending",
  awaiting_curation: "Awaiting curation",
  in_curation: "In curation",
  published: "Published",
  rejected: "Needs changes",
};

export function ReleaseCasesPanel({ wallet }: { wallet: string }) {
  const [cases, setCases] = useState<ReleaseCaseRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Load on mount; state only written inside async callbacks (not synchronously
  // in the effect body).
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getArtistReleaseCases(wallet, 20)
      .then((res) => {
        if (!cancelled) setCases(res.rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  return (
    <section aria-label="Active releases" className="mb-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow className="mb-1 text-[var(--color-rust)]">Active work</Eyebrow>
          <h2 className="font-serif text-2xl font-black tracking-tight">
            What your Release Agent is doing.
          </h2>
        </div>
        <Link
          href="/submit"
          className="self-start sm:self-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] border border-[var(--color-ink)] px-3 py-2 text-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
        >
          Hand a take to your agent →
        </Link>
      </div>

      {failed ? (
        <p className="mt-4 border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-4 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)]">
          Couldn&apos;t load active releases — refresh to retry.
        </p>
      ) : cases === null ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Loading…
        </p>
      ) : cases.length === 0 ? (
        <p className="mt-4 border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-4 font-serif text-sm text-[var(--color-ink-2)]">
          No open releases yet. Submit an alternate take and the agent will prepare the release
          record, waiting on you only where it needs something.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {cases.map((c) => (
            <li key={c.id}>
              <ReleaseCard c={c} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReleaseCard({ c }: { c: ReleaseCaseRow }) {
  return (
    <div className="border border-[var(--color-hair-strong)] p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em]">
          <span className="text-[var(--color-rust)]">release</span>
          <span className="text-[var(--color-ink-3)]">·</span>
          <span className="text-[var(--color-ink-3)]">{STATUS_LABEL[c.submission_status] ?? c.submission_status}</span>
          {c.version_type && (
            <>
              <span className="text-[var(--color-ink-3)]">·</span>
              <span className="text-[var(--color-ink-3)]">{c.version_type}</span>
            </>
          )}
        </div>
        <p className="font-serif text-[16px] font-medium text-[var(--color-ink)]">{c.title}</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          by {c.artist_name}
        </p>
      </div>

      {c.agent_plan && c.agent_plan.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-hair)] pt-3">
          {c.agent_plan.map((s) => (
            <PlanRow key={s.key} s={s} />
          ))}
        </ul>
      )}
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        Last update · {new Date(c.updated_at).toLocaleString()}
      </p>
    </div>
  );
}

function PlanRow({ s }: { s: ReleaseCaseStep }) {
  return (
    <li className="flex items-center gap-2 font-mono text-[10px]">
      <span
        aria-hidden="true"
        className={s.done ? "text-[var(--color-rust)]" : s.current ? "text-[var(--color-rust)]" : "text-[var(--color-ink-3)]"}
      >
        {s.done ? "✓" : s.current ? "!" : "○"}
      </span>
      <span
        className={s.done ? "text-[var(--color-ink-2)]" : s.current ? "text-[var(--color-ink)] font-medium" : "text-[var(--color-ink-3)]"}
      >
        {s.label}
      </span>
    </li>
  );
}