"use client";

// MODULAR: Discover-specific micro-motion. Patterns borrowed from
// transitions.dev / aicss (score pop, success check, thinking pulse) —
// restyled to VERSIONS paper/ink tokens. No third-party effect kits.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export function fitScoreColor(score: number): string {
  if (score >= 8) return "text-green-700";
  if (score >= 5) return "text-amber-700";
  if (score >= 3) return "text-orange-600";
  return "text-[var(--color-ink-3)]";
}

/** Digit pop with blur — fit score lands after the row stagger. */
export function FitScorePop({
  score,
  delay = 0,
  className,
}: {
  score: number;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={reduce ? false : { opacity: 0, y: 6, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        "font-mono text-[13px] font-bold tabular-nums shrink-0",
        fitScoreColor(score),
        className,
      )}
    >
      {score.toFixed(1)}
    </motion.span>
  );
}

/** Spinner → drawn check for shortlist / license confirm. */
export function SuccessCheck({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (!active) return null;
  return (
    <motion.span
      initial={reduce ? false : { scale: 0.4, opacity: 0, rotate: -40 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 520, damping: 22 }}
      className={cn("inline-flex items-center justify-center", className)}
      aria-hidden
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <motion.path
          d="M2.5 6.2 L4.8 8.5 L9.5 3.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="square"
          strokeLinejoin="miter"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.05, duration: 0.28, ease: "easeOut" }}
        />
      </svg>
    </motion.span>
  );
}

const AGENT_STEPS = [
  { label: "Production", verb: "scoring production fit" },
  { label: "Performance", verb: "scoring performance fit" },
  { label: "Market", verb: "scoring market fit" },
] as const;

/**
 * Quiet three-agent "thinking" indicator — editorial pulse, not neon orbs.
 * Cycles the active agent so the wait feels like a pipeline, not a spinner.
 */
export function AgentThinkingPulse({
  paid = false,
}: {
  paid?: boolean;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setStep((s) => (s + 1) % AGENT_STEPS.length), 900);
    return () => clearInterval(id);
  }, [reduce]);

  const active = AGENT_STEPS[step];

  return (
    <div className="py-12" role="status" aria-live="polite">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5" aria-hidden>
          {AGENT_STEPS.map((a, i) => {
            const on = i === step;
            return (
              <motion.span
                key={a.label}
                animate={
                  reduce
                    ? { opacity: on ? 1 : 0.25, scale: 1 }
                    : {
                        opacity: on ? 1 : 0.22,
                        scale: on ? 1.15 : 0.9,
                      }
                }
                transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full",
                  i === 0 && "bg-[var(--color-rust)]",
                  i === 1 && "bg-[var(--color-ink)]",
                  i === 2 && "bg-[var(--color-ink-2)]",
                )}
              />
            );
          })}
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink)]">
            {paid ? "x402 · " : ""}
            {active.label} agent
          </p>
          <p className="font-serif text-sm text-[var(--color-ink-2)] mt-0.5">
            {active.verb}…
          </p>
        </div>
      </div>
    </div>
  );
}
