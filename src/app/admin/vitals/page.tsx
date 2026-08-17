"use client";

// MODULAR: Admin vitals page — money-path health in one glance:
// supervisor search latency (p50/p95), durable outbox depth, and
// settlement sweeper health. Fetches /api/v1/vitals (aggregates only —
// no wallets, no briefs, no PII), same trust model as /admin/funnel.

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

interface VitalsData {
  generatedAt: string;
  search: {
    windowHours: number;
    searches: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  };
  outbox: {
    unprocessed: number;
    processed: number;
    oldestUnprocessedAgeSec: number | null;
  };
  sweeper: {
    last_run_at: string | null;
    last_run_stats: {
      retried?: number;
      settled?: number;
      failed?: number;
      durationMs: number;
      error?: string;
    } | null;
    running: boolean;
  };
  retention: {
    pruned: Record<string, number>;
    skipped: boolean;
    prunedAt: string | null;
  };
}

const WINDOWS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;

function fmtAge(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

export default function VitalsAdminPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-4xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Admin · Health
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Money-path vitals.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            Supervisor search latency, the durable receipt outbox, and the
            settlement sweeper. Aggregates only — no wallets, no briefs.
          </p>
          <VitalsPanel />
        </main>
      </div>
    </ToastProvider>
  );
}

function VitalsPanel() {
  const { showToast } = useToast();
  const [data, setData] = useState<VitalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hours, setHours] = useState(24);

  const dataRef = useRef<VitalsData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const fetchVitals = useCallback(
    async (h: number) => {
      setLoading(true);
      setError(false);
      try {
        const resp = await fetch(`/api/v1/vitals?hours=${h}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as { data?: VitalsData };
        setData(json.data ?? null);
      } catch (err) {
        setError(true);
        if (dataRef.current) {
          showToast(`Refresh failed: ${(err as Error).message}`, "error", 4000);
        }
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchVitals(hours);
  }, [fetchVitals, hours]);

  const onRefresh = () => {
    void fetchVitals(hours);
  };

  const outboxBacklog = data ? data.outbox.unprocessed > 10 : false;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8 border-t border-b border-[var(--color-hair-strong)] py-4">
        <div className="flex items-center gap-2" role="group" aria-label="Vitals window">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-2">
            Window
          </span>
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setHours(w.hours)}
              aria-pressed={hours === w.hours}
              className={cn(
                "font-mono text-[11px] uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors",
                hours === w.hours
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]"
                  : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {loading && !data ? (
        <p className="py-12 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]" role="status">
          Loading…
        </p>
      ) : error && !data ? (
        <div className="border-t border-b border-[var(--color-rust)] py-10 text-center">
          <p className="font-serif text-[var(--color-ink-2)] mb-4">
            Couldn&rsquo;t load the vitals.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-rust)] hover:text-[var(--color-ink)] transition-colors"
          >
            <span aria-hidden="true">↻ </span>Retry
          </button>
        </div>
      ) : data ? (
        <div className="space-y-10">
          {/* 1 — Search latency */}
          <section aria-labelledby="vitals-search">
            <h3 id="vitals-search" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)] mb-4">
              1 · Supervisor search latency
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Stat label="p50" value={data.search.p50Ms !== null ? `${data.search.p50Ms}ms` : "—"} />
              <Stat label="p95" value={data.search.p95Ms !== null ? `${data.search.p95Ms}ms` : "—"} />
              <Stat label="max" value={data.search.maxMs !== null ? `${data.search.maxMs}ms` : "—"} />
              <Stat label={`searches (${data.search.windowHours}h)`} value={String(data.search.searches)} />
            </div>
            {data.search.searches === 0 && (
              <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                No logged searches in window — latency samples arrive from logged brief searches (signed-in and guest device-id).
              </p>
            )}
          </section>

          {/* 2 — Outbox */}
          <section aria-labelledby="vitals-outbox">
            <h3 id="vitals-outbox" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)] mb-4">
              2 · Receipt outbox
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <Stat
                label="unprocessed"
                value={String(data.outbox.unprocessed)}
                warn={outboxBacklog}
              />
              <Stat label="processed" value={String(data.outbox.processed)} />
              <Stat label="oldest backlog" value={fmtAge(data.outbox.oldestUnprocessedAgeSec)} warn={outboxBacklog} />
            </div>
            {outboxBacklog && (
              <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)]" role="status">
                Receipt backlog above 10 — check the sweep cron.
              </p>
            )}
          </section>

          {/* 3 — Sweeper */}
          <section aria-labelledby="vitals-sweeper">
            <h3 id="vitals-sweeper" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)] mb-4">
              3 · Settlement sweeper
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Stat label="last run" value={data.sweeper.last_run_at ? new Date(data.sweeper.last_run_at).toLocaleString() : "never"} />
              <Stat label="settled" value={data.sweeper.last_run_stats ? String(data.sweeper.last_run_stats.settled ?? 0) : "—"} />
              <Stat label="failed" value={data.sweeper.last_run_stats ? String(data.sweeper.last_run_stats.failed ?? 0) : "—"} warn={!!data.sweeper.last_run_stats?.failed} />
              <Stat label="last tick" value={data.sweeper.last_run_stats ? `${data.sweeper.last_run_stats.durationMs}ms` : "—"} />
            </div>
            {data.sweeper.last_run_stats?.error && (
              <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)]" role="alert">
                Last tick errored: {data.sweeper.last_run_stats.error}
              </p>
            )}
          </section>

          {/* 4 — Retention */}
          <section aria-labelledby="vitals-retention">
            <h3 id="vitals-retention" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)] mb-4">
              4 · Retention
            </h3>
            <p className="font-mono text-[11px] text-[var(--color-ink-2)]">
              Last prune: {data.retention.prunedAt ? new Date(data.retention.prunedAt).toLocaleString() : "not yet (runs on the sweep cron, max once / 30 min)"}
            </p>
            {Object.keys(data.retention.pruned).length > 0 && (
              <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-3)]">
                {Object.entries(data.retention.pruned)
                  .map(([t, n]) => `${t}: ${n}`)
                  .join(" · ")}
              </p>
            )}
          </section>

          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] border-t border-[var(--color-hair)] pt-4">
            Snapshot {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="border border-[var(--color-hair-strong)] bg-[var(--color-paper)] px-4 py-3">
      <p className={cn("font-mono text-[9px] uppercase tracking-[0.16em]", warn ? "text-[var(--color-rust)]" : "text-[var(--color-ink-3)]")}>
        {label}
      </p>
      <p className={cn("mt-1 font-serif text-xl font-semibold break-all", warn ? "text-[var(--color-rust)]" : "text-[var(--color-ink)]")}>
        {value}
      </p>
    </div>
  );
}
