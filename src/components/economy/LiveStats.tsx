"use client";

// MODULAR: live stats counter for the landing page. Fetches aggregate
// counts from /api/economy/stats on mount, then increments in real time
// as SSE economy events arrive. Numbers animate with a count-up effect
// so the judge sees the platform growing while they watch — combining
// variable reward schedule (unpredictable increments) with progression
// design (numbers only go up).

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import { settlementToEconomyEvent, type EconomyEvent } from "@/lib/event-bus";
import { fmtUsdc } from "@/lib/format";
import { SettlementSplitBar, type SplitLeg } from "@/components/economy/SettlementSplitBar";
import { useSettlementEvents } from "@/lib/use-settlement-events";

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
  const initializedRef = useRef(false);
  const seenSettlementKeysRef = useRef<Set<string>>(new Set());
  const pendingSettlementsRef = useRef<EconomyEvent[]>([]);

  const applySettlementToState = useCallback((event: EconomyEvent) => {
    setStats((prev) => {
      const next = { ...prev };
      if (event.amountUsdc) next.usdcSettled += Number(event.amountUsdc);
      if (event.kind === "leg_settled" && event.recipientRole && event.amountUsdc) {
        const amount = Number(event.amountUsdc);
        const split = prev.settlementSplit.map((s) => ({ ...s }));
        const idx = split.findIndex((s) => s.role === event.recipientRole);
        if (idx >= 0) {
          split[idx].totalUsdc = String(Number(split[idx].totalUsdc) + amount);
          split[idx].legCount += 1;
        } else {
          split.push({ role: event.recipientRole, totalUsdc: String(amount), legCount: 1 });
        }
        next.settlementSplit = split;
      }
      return next;
    });
  }, []);

  const flushPendingSettlements = useCallback(() => {
    initializedRef.current = true;
    const pending = pendingSettlementsRef.current;
    pendingSettlementsRef.current = [];
    pending.forEach(applySettlementToState);
  }, [applySettlementToState]);

  const applySettlement = useCallback((event: EconomyEvent) => {
    const key = event.settlementId ?? `${event.kind}|${event.txHash ?? ""}|${event.timestamp}`;
    if (seenSettlementKeysRef.current.has(key)) return;
    seenSettlementKeysRef.current.add(key);
    if (seenSettlementKeysRef.current.size > 200) {
      const oldest = seenSettlementKeysRef.current.values().next().value;
      if (oldest) seenSettlementKeysRef.current.delete(oldest);
    }
    if (!initializedRef.current) {
      pendingSettlementsRef.current.push(event);
      return;
    }
    applySettlementToState(event);
  }, [applySettlementToState]);

  // Canonical receipt stream: every dashboard sees the same settlement
  // transition, while the key guard prevents the compatibility
  // economy-event from incrementing the counters a second time.
  useSettlementEvents((event) => {
    applySettlement(settlementToEconomyEvent(event));
  });

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/economy/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (!body?.data) {
          setLoaded(true);
          flushPendingSettlements();
          return;
        }
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
        flushPendingSettlements();
      })
      .catch(() => {
        setLoaded(true);
        flushPendingSettlements();
      });
    return () => {
      cancelled = true;
    };
  }, [flushPendingSettlements]);

  // SSE: increment counters as economy events arrive.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("economy-event", (msg) => {
      try {
        const e = JSON.parse((msg as MessageEvent).data) as EconomyEvent;
        if (e.kind === "review") {
          setStats((prev) => ({ ...prev, agentReviews: prev.agentReviews + 1 }));
        } else {
          // Compatibility path for existing economy-event producers;
          // canonical settlement-event uses the same settlementId.
          applySettlement(e);
        }
      } catch {
        /* malformed — ignore */
      }
    });
    return () => es.close();
  }, [applySettlement]);

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
      <div className="flex min-w-0 items-stretch justify-center gap-3 sm:gap-10 md:gap-16">
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
    <div className="min-w-0 text-center">
      <motion.div
        key={formatted}
        initial={{ scale: 1.08, color: "var(--color-rust)" }}
        animate={{ scale: 1, color: "var(--color-ink)" }}
        transition={{ duration: 0.3 }}
        className="font-serif text-2xl sm:text-3xl md:text-4xl font-black tabular-nums"
      >
        {formatted}
      </motion.div>
      <div className="break-words font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mt-1">
        {label}
      </div>
    </div>
  );
}
