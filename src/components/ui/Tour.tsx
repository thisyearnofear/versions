"use client";

// MODULAR: First-visit guided tour. A 3-step overlay that walks
// through the Submit / Curate / Feed flow. State (seen flag,
// current step) is held in the component; persistence is via
// localStorage so the tour shows once per browser.

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lepton_tour_seen";

interface TourStep {
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: "01 · Submit a version",
    body:
      "Pay 0.50 USDC to put a take in the queue. The fee funds the curator pool — split 70/20/10 between the curators, the platform, and your own attribution. After three ratings your version publishes to the feed.",
  },
  {
    title: "02 · Curate via the taste graph",
    body:
      "Claim a submission and rate it across four quantitative dimensions on the radar. The polygon is your rating; the readout below shows the live values. Energy and tempo snap to lower/same/higher and dragging/locked/rushing at submit time.",
  },
  {
    title: "03 · Discover the feed",
    body:
      "The feed is the catalog of published versions. Each row carries the aggregated taste graph, the rating dimensions, the mood tags, and a player. Filter by mood, energy, tempo, or solo intensity.",
  },
];

export interface TourProps {
  /** Open the tour on mount (used to seed the first-visit experience). */
  autoStart?: boolean;
  /** Render a "?" trigger in the bottom-left that re-opens the tour. */
  withTrigger?: boolean;
  className?: string;
}

export function Tour({ autoStart = false, withTrigger = true, className }: TourProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(true); // assume seen until we know otherwise (avoids flash)

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      const isSeen = v === "1";
      setSeen(isSeen);
      if (autoStart && !isSeen) {
        setOpen(true);
        setStep(0);
      }
    } catch {
      /* localStorage blocked — silently skip */
    }
  }, [autoStart]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setSeen(true);
  }, []);

  const next = useCallback(() => {
    if (step + 1 >= STEPS.length) {
      close();
    } else {
      setStep((s) => s + 1);
    }
  }, [close, step]);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSeen(false);
    setStep(0);
    setOpen(true);
  }, []);

  if (!open) {
    return withTrigger ? (
      <button
        type="button"
        onClick={reset}
        title="Restart the tour"
        className={cn(
          "fixed bottom-5 left-5 w-9 h-9 rounded-full grid place-items-center",
          "bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-sm",
          "opacity-60 hover:opacity-100 transition-opacity z-50",
          className,
        )}
      >
        ?
      </button>
    ) : null;
  }

  const current = STEPS[step];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1000] grid place-items-center px-5 bg-[rgba(244,239,229,0.92)] animate-[tourFade_0.18s_ease-out]"
    >
      <div className="bg-[var(--color-paper)] border border-[var(--color-ink)] p-8 md:p-10 max-w-[520px] w-full shadow-[8px_8px_0_var(--color-ink)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mb-3">
          Step {step + 1} of {STEPS.length}
        </p>
        <h3 className="font-serif text-2xl md:text-3xl font-medium tracking-tight mb-3">
          {current.title}
        </h3>
        <p className="font-serif text-[15px] leading-[1.55] text-[var(--color-ink-2)] mb-6">
          {current.body}
        </p>
        <div className="flex justify-end items-center gap-3">
          <button
            type="button"
            onClick={close}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] hover:text-[var(--color-rust)] px-2 py-1"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={next}
            className="font-mono text-[11px] uppercase tracking-[0.18em] bg-[var(--color-rust)] text-[var(--color-paper)] border border-[var(--color-rust)] px-4 py-3 hover:bg-[var(--color-rust-dark)]"
          >
            {step + 1 === STEPS.length ? "Got it" : "Next"}
          </button>
        </div>
      </div>
      <style jsx global>{`
        @keyframes tourFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
