"use client";

// MODULAR: live match-quality readout for the supervisor dashboard. Shows the
// ground-truth moat in one glance: how many labeled judgments exist and how
// well the matcher is ranking them (MRR, precision@1/3, score discrimination).
// Read-only via GET /api/v1/discover/benchmark; with no labels yet it nudges
// the reviewer to contribute via the Good/Wrong-fit taps on Discover.

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { MatchBenchmarkReport } from "@/lib/match-benchmark";
import { useToast } from "@/components/ui/Toast";

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "–";
}
function num(v: number | null, d = 3): string {
  return v != null ? v.toFixed(d) : "–";
}

export function MatchBenchmarkPanel() {
  const { showToast } = useToast();
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

  return (
    <section className="border-t border-[var(--color-hair-strong)] pt-8">
      <h3 className="mb-1 font-serif text-2xl font-black tracking-tight">Match quality</h3>
      <p className="mb-4 font-serif text-sm text-[var(--color-ink-3)]">
        Ground truth from your Good/Wrong-fit labels — the asset that makes the
        matcher measurably better.
      </p>

      {loading ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">Loading…</p>
      ) : failed ? (
        <p className="font-serif text-[var(--color-ink-2)]">
          Match-quality report unavailable right now — try again in a moment.
        </p>
      ) : !report || report.judgmentCount === 0 ? (
        <p className="font-serif text-[var(--color-ink-2)]">
          No ground truth yet. Return to <span className="italic text-[var(--color-rust)]">Discover</span>, run a brief,
          and tap <span className="italic">Good fit</span> / <span className="italic">Wrong fit</span> — the matcher
          improves with every label.
        </p>
      ) : (
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Stat label="Judgments" value={String(report.judgmentCount)} />
          <Stat label="Good fraction" value={pct(report.goodFraction)} />
          <Stat label="MRR" value={num(report.mrr)} />
          <Stat label="Precision@1" value={pct(report.precisionAt[1])} />
          <Stat label="Precision@3" value={pct(report.precisionAt[3])} />
          <Stat label="Score Δ (good−wrong)" value={report.scoreDiscrimination.delta != null ? num(report.scoreDiscrimination.delta, 2) : "–"} />
        </dl>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">{label}</dt>
      <dd className="mt-1 font-serif text-2xl font-bold leading-none">{value}</dd>
    </div>
  );
}