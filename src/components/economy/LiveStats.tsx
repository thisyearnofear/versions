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

interface Stats {
  tracksPublished: number;
  agentReviews: number;
  usdcSettled: number;
}

const INITIAL: Stats = { tracksPublished: 0, agentReviews: 0, usdcSettled: 0 };

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
        setStats({
          tracksPublished: Number(body.data.tracksPublished ?? 0),
          agentReviews: Number(body.data.agentReviews ?? 0),
          usdcSettled: Number(body.data.usdcSettled ?? 0),
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
              if (e.amountUsdc) next.usdcSettled += Number(e.amountUsdc);
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

  return (
    <div className="flex justify-center gap-8 md:gap-16 py-2">
      <StatItem
        label="Tracks"
        value={stats.tracksPublished}
        loaded={loaded}
      />
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
        className="font-serif text-3xl md:text-4xl font-black tabular-nums"
      >
        {formatted}
      </motion.div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mt-1">
        {label}
      </div>
    </div>
  );
}
