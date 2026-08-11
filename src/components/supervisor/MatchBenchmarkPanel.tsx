"use client";

// MODULAR: live match-quality readout for the supervisor dashboard. Shows the
// ground-truth moat in one glance: how many labeled judgments exist and how
// well the matcher is ranking them (MRR, precision@1/3, score discrimination).
// Read-only via GET /api/v1/discover/benchmark; with no labels yet it nudges
// the reviewer to contribute via the Good/Wrong-fit taps on Discover.

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { MatchBenchmarkReport } from "@/lib/match-benchmark";
import { Section } from "@/components/ui/primitives";
import Link from "next/link";

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "–";
}
function num(v: number | null, d = 3): string {
  return v != null ? v.toFixed(d) : "–";
}

export function MatchBenchmarkPanel({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<MatchBenchmarkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await apiClient.getMatchBenchmark();
      setReport(Array.isArray(res) ? null : res.report);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const content = loading ? (
    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">Loading…</p>
  ) : failed ? (
    <p className="font-serif text-sm text-[var(--color-ink-2)]">
      Match-quality report unavailable — try again in a moment.
    </p>
  ) : !report || report.judgmentCount === 0 ? (
    <p className="font-serif text-sm text-[var(--color-ink-2)]">
      No labels yet. On{" "}
      <Link href="/discover" className="text-[var(--color-rust)] hover:underline">
        Discover
      </Link>
      , tap Good fit / Wrong fit to improve the matcher.
    </p>
  ) : (
    <dl className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Stat label="Judgments" value={String(report.judgmentCount)} compact={compact} />
      <Stat label="Good fraction" value={pct(report.goodFraction)} compact={compact} />
      <Stat label="MRR" value={num(report.mrr)} compact={compact} />
      <Stat label="Precision@1" value={pct(report.precisionAt[1])} compact={compact} />
      <Stat label="Precision@3" value={pct(report.precisionAt[3])} compact={compact} />
      <Stat label="Score Δ" value={report.scoreDiscrimination.delta != null ? num(report.scoreDiscrimination.delta, 2) : "–"} compact={compact} />
    </dl>
  );

  if (compact) {
    return (
      <Section eyebrow="Quality" title="Match labels" className="py-8">
        {content}
      </Section>
    );
  }

  return (
    <section className="border-t border-[var(--color-hair-strong)] pt-8">
      <h3 className="mb-1 font-serif text-2xl font-black tracking-tight">Match quality</h3>
      <p className="mb-4 font-serif text-sm text-[var(--color-ink-3)]">
        Ground truth from your Good/Wrong-fit labels — the asset that makes the
        matcher measurably better.
      </p>
      {content}
    </section>
  );
}

function Stat({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="border border-[var(--color-hair)] rounded-sm p-3">
      <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">{label}</dt>
      <dd className={compact ? "mt-1 font-serif text-xl font-bold leading-none" : "mt-1 font-serif text-2xl font-bold leading-none"}>{value}</dd>
    </div>
  );
}