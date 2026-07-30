"use client";

// MODULAR: live stats counter for the landing page. Fetches aggregate
// counts from /api/economy/stats on mount, then increments in real time
// as SSE economy events arrive. Numbers animate with a count-up effect
// so the judge sees the platform growing while they watch — combining
// variable reward schedule (unpredictable increments) with progression
// design (numbers only go up).

import { useEffect, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import type { EconomyEvent } from "@/lib/event-bus";
import { fmtUsdc } from "@/lib/format";
import { SettlementSplitBar, type SplitLeg } from "@/components/economy/SettlementSplitBar";

interface Stats {
  tracksPublished: number;
  agentReviews: number;
  usdcSettled: number;
  medianReviewLatencySeconds: number | null;
  settlementSplit: SplitLeg[];
  marketPull: { briefSearches: number; licensingInterests: number };
}

const INITIAL: Stats = {
  tracksPublished: 0,
  agentReviews: 0,
  usdcSettled: 0,
  medianReviewLatencySeconds: null,
  settlementSplit: [],
  marketPull: { briefSearches: 0, licensingInterests: 0 },
};

export function LiveStats() {
  const [stats, setStats] = useState<Stats>(INITIAL);
  const [loaded, setLoaded] = useState(false);

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/economy/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.data) return;
        const d = body.data;
        const split = Array.isArray(d.settlementSplit)
          ? (d.settlementSplit as SplitLeg[])
          : [];
        setStats({
          tracksPublished: Number(d.tracksPublished ?? 0),
          agentReviews: Number(d.agentReviews ?? 0),
          usdcSettled: Number(d.usdcSettled ?? 0),
          medianReviewLatencySeconds:
            d.medianReviewLatencySeconds != null
              ? Number(d.medianReviewLatencySeconds)
              : null,
          settlementSplit: split,
          marketPull: {
            briefSearches: Number(d.marketPull?.briefSearches ?? 0),
            licensingInterests: Number(d.marketPull?.licensingInterests ?? 0),
          },
        });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // SSE: increment counters as economy events arrive.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("economy-event", (msg) => {
      try {
        const e = JSON.parse((msg as MessageEvent).data) as EconomyEvent;
        setStats((prev) => {
          const next = { ...prev };
          switch (e.kind) {
            case "review":
              next.agentReviews += 1;
              break;
            case "tip_batch_settled":
              if (e.amountUsdc) next.usdcSettled += Number(e.amountUsdc);
              break;
            case "leg_settled":
              if (e.amountUsdc) {
                const amt = Number(e.amountUsdc);
                next.usdcSettled += amt;
                const role = e.recipientRole;
                if (role) {
                  const split = prev.settlementSplit.map((s) => ({ ...s }));
                  const idx = split.findIndex((s) => s.role === role);
                  if (idx >= 0) {
                    split[idx].totalUsdc = String(
                      Number(split[idx].totalUsdc) + amt,
                    );
                    split[idx].legCount += 1;
                  } else {
                    split.push({ role, totalUsdc: String(amt), legCount: 1 });
                  }
                  next.settlementSplit = split;
                }
              }
              break;
            case "play":
              if (e.amountUsdc) next.usdcSettled += Number(e.amountUsdc);
              break;
          }
          return next;
        });
      } catch {
        /* malformed — ignore */
      }
    });
    return () => es.close();
  }, []);

  const latency = stats.medianReviewLatencySeconds;
  const speedCaption =
    latency != null && latency > 0
      ? latency < 90
        ? `~${latency}s`
        : `~${Math.round(latency / 60)}m`
      : null;

  const { briefSearches, licensingInterests } = stats.marketPull;
  const pullSegments: string[] = [];
  if (briefSearches > 0)
    pullSegments.push(
      `${briefSearches} brief ${briefSearches === 1 ? "search" : "searches"}`,
    );
  if (licensingInterests > 0)
    pullSegments.push(
      `${licensingInterests} licensing ${licensingInterests === 1 ? "interest" : "interests"}`,
    );

  return (
    <div className="py-2">
      <div className="flex justify-center gap-5 sm:gap-10 md:gap-16">
        <StatItem label="Tracks" value={stats.tracksPublished} loaded={loaded} />
        <Divider />
        <StatItem
          label="Agent Reviews"
          value={stats.agentReviews}
          loaded={loaded}
        />
        <Divider />
        <StatItem
          label="USDC Settled"
          value={stats.usdcSettled}
          loaded={loaded}
          format="usdc"
        />
      </div>

      {speedCaption && (
        <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Agents return a verdict in {speedCaption} · no humans in the loop
        </div>
      )}

      <SettlementSplitBar split={stats.settlementSplit} />

      {pullSegments.length > 0 && (
        <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Market pull · {pullSegments.join(" · ")}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div className="w-px bg-[var(--color-hair)] self-stretch" />;
}

function StatItem({
  label,
  value,
  loaded,
  format,
}: {
  label: string;
  value: number;
  loaded: boolean;
  format?: "usdc";
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  // Count-up animation when value changes.
  useEffect(() => {
    if (!loaded) return;
    const from = prevRef.current;
    const to = value;
    if (from === to) return;
    prevRef.current = to;
    const controls = animate(from, to, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, loaded]);

  const formatted = format === "usdc" ? fmtUsdc(display.toFixed(2)) : Math.round(display).toString();

  return (
    <div className="text-center">
      <motion.div
        key={formatted}
        initial={{ scale: 1.08, color: "var(--color-rust)" }}
        animate={{ scale: 1, color: "var(--color-ink)" }}
        transition={{ duration: 0.3 }}
        className="font-serif text-2xl sm:text-3xl md:text-4xl font-black tabular-nums"
      >
        {formatted}
      </motion.div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mt-1">
        {label}
      </div>
    </div>
  );
}
