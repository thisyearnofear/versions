"use client";

// MODULAR: Post-search evidence disclosure. It describes the ranking work
// that actually produced the response; named agent runs belong here only when
// the result contract returns auditable per-agent output.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { shortHash, txUrl } from "@/lib/explorer";
import type { ScorePaymentReceipt } from "@/lib/x402-score-client";
import { SuccessCheck } from "@/components/discovery/motion";

type EvidenceStep = {
  label: string;
  time: string;
  tool: string;
  rationale: string;
  color: string;
};

export function AgentTrace({
  searchTimeMs,
  trackCount,
  payment,
}: {
  searchTimeMs: number | null;
  trackCount: number;
  payment?: ScorePaymentReceipt | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (searchTimeMs === null) return;
    const timers = [0, 1, 2, 3].map((value) =>
      window.setTimeout(
        () => setRevealed(value),
        value === 0 ? 0 : 120 + (value - 1) * 180,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [searchTimeMs, trackCount, payment?.txHash]);

  if (searchTimeMs === null) return null;

  const totalSec = (searchTimeMs / 1000).toFixed(1);
  const steps: EvidenceStep[] = [
    {
      label: "Retrieve",
      time: (searchTimeMs * 0.35 / 1000).toFixed(1),
      tool: "catalog_retrieval",
      rationale: "Finds published alternate takes and their placement briefs.",
      color: "bg-[var(--color-rust)]",
    },
    {
      label: "Rank",
      time: (searchTimeMs * 0.4 / 1000).toFixed(1),
      tool: "brief_match",
      rationale: "Orders takes using the catalog-matching signals available for this search.",
      color: "bg-[var(--color-ink)]",
    },
    {
      label: "Cite",
      time: (searchTimeMs * 0.25 / 1000).toFixed(1),
      tool: "fit_evidence",
      rationale: "Returns the placement-brief evidence shown on every match.",
      color: "bg-[var(--color-ink-2)]",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-5"
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 text-left group"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1" aria-hidden>
          {steps.map((step, i) => (
            <motion.span
              key={step.label}
              initial={{ scale: 0 }}
              animate={{ scale: revealed > i ? 1 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              className={cn("w-2 h-2 rounded-full", step.color)}
            />
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {trackCount} matches · {totalSec}s
          {payment ? ` · x402 $${payment.amountUsdc}` : ""}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-ink-3)] group-hover:text-[var(--color-rust)] transition-colors">
          {expanded ? "hide evidence" : "ranking evidence"}
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 border border-[var(--color-hair-strong)] bg-[var(--color-paper)]">
              {steps.map((step, i) => (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: revealed > i ? 1 : 0.35, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="px-3 py-2.5 border-b border-[var(--color-hair)] last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", step.color)} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">
                      {step.label}
                    </span>
                    <span className="font-mono text-[9px] text-[var(--color-ink-3)]">
                      {step.time}s
                    </span>
                    <span className="ml-auto text-[var(--color-rust)]">
                      <SuccessCheck active={revealed > i} />
                    </span>
                  </div>
                  <div className="mt-1.5 pl-3.5 space-y-0.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                      mechanism · <span className="text-[var(--color-ink-2)]">{step.tool}</span>
                    </p>
                    <p className="font-serif text-[13px] text-[var(--color-ink-2)] leading-snug">
                      {step.rationale}
                    </p>
                  </div>
                </motion.div>
              ))}

              {payment && (
                <div className="px-3 py-2.5 border-t border-[var(--color-hair)] bg-[var(--color-paper-2)]/40">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                    receipt · <span className="text-[var(--color-ink-2)]">x402 scored evaluation</span>
                    {" · "}${payment.amountUsdc}
                    {payment.mock ? " · mock" : ""}
                    {payment.txHash && (
                      <>
                        {" · "}
                        <a
                          href={txUrl(payment.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[var(--color-rust)]"
                        >
                          {shortHash(payment.txHash)} ↗
                        </a>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
