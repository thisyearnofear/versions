"use client";

// MODULAR: Admin funnel analysis page. Fetches /api/v1/funnel and
// renders a visual funnel chart with horizontal bars proportional
// to each step's session count. Shows drop-off per step and overall
// conversion rate. Includes a time-window selector (24h / 7d / 30d)
// and a refresh button.
//
// No auth gate — the data is anonymous (session IDs only, no wallet
// addresses). If access needs to be restricted later, add an admin
// token check here.

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

// MODULAR: mirror the FunnelBreakdown shape from src/services/telemetry.ts.
// We don't import the type from the service (which imports drizzle/db) to
// keep this page a pure client component with no server-side dependencies.
interface FunnelStepResult {
  step: string;
  sessions: number;
  dropOff: number;
  dropOffPct: number | null;
  conversionPct: number | null;
}

interface FunnelBreakdown {
  totalSessions: number;
  steps: FunnelStepResult[];
  windowHours: number;
  generatedAt: string;
}

// Human-readable labels for each funnel step.
const STEP_LABELS: Record<string, string> = {
  page_view: "Landed on site",
  nav_click: "Clicked a nav link",
  form_start: "Started the submit form",
  submit_attempt: "Clicked submit",
  submit_success: "Submission succeeded",
};

const WINDOWS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;

export default function FunnelAdminPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-4xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Admin · Analytics
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Funnel analysis.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            Per-session drop-off from landing through to a successful
            submission. Each bar is proportional to the number of sessions
            that reached that step.
          </p>
          <FunnelChart />
        </main>
      </div>
    </ToastProvider>
  );
}

function FunnelChart() {
  const { showToast } = useToast();
  const [data, setData] = useState<FunnelBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hours, setHours] = useState(168);

  // MODULAR: ref to check if data already exists inside the catch
  // block without adding `data` to the fetchBreakdown deps (which
  // would cause an infinite fetch loop — every successful fetch
  // assigns a new object reference to data, recreating the callback,
  // re-running the effect, fetching again). The ref is updated in a
  // separate effect and read inside the catch block.
  const dataRef = useRef<FunnelBreakdown | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const fetchBreakdown = useCallback(
    async (h: number) => {
      setLoading(true);
      setError(false);
      try {
        const resp = await fetch(`/api/v1/funnel?hours=${h}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as { data?: FunnelBreakdown };
        setData(json.data ?? null);
      } catch (err) {
        setError(true);
        // MODULAR: if we already have data, surface a toast so the
        // team knows the displayed numbers are stale rather than
        // silently keeping the old data with no indication.
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
    void fetchBreakdown(hours);
  }, [fetchBreakdown, hours]);

  const onWindowChange = (h: number) => {
    setHours(h);
  };

  const onRefresh = () => {
    void fetchBreakdown(hours);
  };

  const maxSessions = data?.steps?.[0]?.sessions ?? 0;

  return (
    <>
      {/* Controls: window selector + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8 border-t border-b border-[var(--color-hair-strong)] py-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-2">
            Window
          </span>
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              onClick={() => onWindowChange(w.hours)}
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

      {/* Loading state */}
      {loading && !data ? (
        <FunnelSkeleton />
      ) : error && !data ? (
        <div className="border-t border-b border-[var(--color-rust)] py-10 text-center">
          <p className="font-serif text-[var(--color-ink-2)] mb-4">
            Couldn&rsquo;t load the funnel data.
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
        <>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-6 mb-10">
            <StatCard
              label="Total sessions"
              value={String(data.totalSessions)}
            />
            <StatCard
              label="Overall conversion"
              value={
                data.totalSessions > 0 && data.steps.length > 0
                  ? `${data.steps[data.steps.length - 1].conversionPct ?? 0}%`
                  : "—"
              }
            />
            <StatCard
              label="Window"
              value={data.windowHours >= 24 ? `${data.windowHours / 24}d` : `${data.windowHours}h`}
            />
          </div>

          {/* Funnel bars */}
          {data.totalSessions === 0 ? (
            <div className="border-t border-b border-[var(--color-hair)] py-10 text-center">
              <p className="font-serif italic text-[var(--color-ink-3)]">
                No telemetry events in this window yet. Once visitors land on
                the site, the funnel will populate.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {data.steps.map((step, i) => {
                const widthPct = maxSessions > 0 ? (step.sessions / maxSessions) * 100 : 0;
                const isLast = i === data.steps.length - 1;
                return (
                  <div key={step.step}>
                    {/* Bar row */}
                    <div className="py-5 border-t border-[var(--color-hair)]">
                      <div className="flex items-baseline justify-between mb-2 gap-4">
                        <div className="flex items-baseline gap-3 min-w-0">
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] tabular-nums shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="font-serif text-lg font-medium truncate">
                            {STEP_LABELS[step.step] ?? step.step}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-4 shrink-0">
                          <span className="font-mono text-sm font-bold tabular-nums text-[var(--color-ink)]">
                            {step.sessions}
                          </span>
                          {i > 0 && step.conversionPct !== null && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-[var(--color-ink-3)]">
                              {step.conversionPct}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* The bar */}
                      <div className="h-7 bg-[var(--color-paper-2)] relative overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-ink)] transition-all duration-700 ease-out"
                          style={{ width: `${Math.max(widthPct, 2)}%` }}
                        />
                      </div>
                    </div>

                    {/* Drop-off callout between steps */}
                    {!isLast && (
                      <DropOffRow
                        dropOff={data.steps[i + 1].dropOff}
                        dropOffPct={data.steps[i + 1].dropOffPct}
                      />
                    )}
                  </div>
                );
              })}
              <div className="border-t border-b border-[var(--color-hair)]" />
            </div>
          )}

          {/* Generated-at timestamp */}
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-6">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      ) : null}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-[var(--color-ink)] pt-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">
        {label}
      </div>
      <div className="font-serif text-3xl font-black tracking-tight text-[var(--color-ink)]">
        {value}
      </div>
    </div>
  );
}

function DropOffRow({
  dropOff,
  dropOffPct,
}: {
  dropOff: number;
  dropOffPct: number | null;
}) {
  if (dropOff === 0) {
    return (
      <div className="flex items-center gap-2 py-1.5 pl-9">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          ↓ no drop-off
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5 pl-9">
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)]">
        ↓ {dropOff} lost
      </span>
      {dropOffPct !== null && (
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          ({dropOffPct}% drop-off)
        </span>
      )}
    </div>
  );
}

function FunnelSkeleton() {
  return (
    <div className="flex flex-col gap-0">
      {/* Summary skeleton */}
      <div className="grid grid-cols-3 gap-6 mb-10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-t border-[var(--color-ink)] pt-3">
            <div className="skel h-[10px] w-[80px] mb-2" />
            <div className="skel h-[28px] w-[60px]" />
          </div>
        ))}
      </div>
      {/* Bars skeleton */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="py-5 border-t border-[var(--color-hair)]">
          <div className="flex items-baseline justify-between mb-2">
            <div className="flex items-baseline gap-3">
              <div className="skel h-[10px] w-[20px]" />
              <div className="skel h-[18px] w-[180px]" />
            </div>
            <div className="skel h-[14px] w-[40px]" />
          </div>
          <div className="h-7 bg-[var(--color-paper-2)]">
            <div
              className="skel h-full"
              style={{ width: `${100 - i * 15}%` }}
            />
          </div>
        </div>
      ))}
      <div className="border-t border-b border-[var(--color-hair)]" />
    </div>
  );
}
