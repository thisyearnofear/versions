"use client";

// MODULAR: Post-search agent pipeline reveal. Structured like aicss
// tool/thinking blocks (status → tool → rationale) but in VERSIONS tokens.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { shortHash, txUrl } from "@/lib/explorer";
import type { ScorePaymentReceipt } from "@/lib/x402-score-client";
import { SuccessCheck } from "@/components/discovery/motion";

type TraceStep = {
  label: string;
  key: string;
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
  const [agentIds, setAgentIds] = useState<Record<string, string>>({});

  useEffect(() => {
    void apiClient
      .getAgentIdentities()
      .then((res) => {
        const map: Record<string, string> = {};
        for (const a of res.agents) map[a.label] = a.agentId;
        setAgentIds(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setRevealed(0);
    if (searchTimeMs === null) return;
    const timers = [0, 1, 2, 3].map((i) =>
      window.setTimeout(() => setRevealed(i + 1), 120 + i * 180),
    );
    return () => timers.forEach(clearTimeout);
  }, [searchTimeMs, trackCount, payment?.txHash]);

  if (searchTimeMs === null) return null;

  const totalSec = (searchTimeMs / 1000).toFixed(1);
  const steps: TraceStep[] = [
    {
      label: "Production",
      key: "production",
      time: (searchTimeMs * 0.35 / 1000).toFixed(1),
      tool: "score_production",
      rationale: "Mix, arrangement, and sonic finish vs brief",
      color: "bg-[var(--color-rust)]",
    },
    {
      label: "Performance",
      key: "performance",
      time: (searchTimeMs * 0.3 / 1000).toFixed(1),
      tool: "score_performance",
      rationale: "Feel, dynamics, and take character vs brief",
      color: "bg-[var(--color-ink)]",
    },
    {
      label: "Market",
      key: "market",
      time: (searchTimeMs * 0.35 / 1000).toFixed(1),
      tool: "score_market",
      rationale: "Placement fit and sync readiness vs brief",
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
          {steps.map((a, i) => (
            <motion.span
              key={a.label}
              initial={{ scale: 0 }}
              animate={{ scale: revealed > i ? 1 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              className={cn("w-2 h-2 rounded-full", a.color)}
            />
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {trackCount} tracks · {totalSec}s · Arc
          {payment ? ` · x402 $${payment.amountUsdc}` : ""}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-ink-3)] group-hover:text-[var(--color-rust)] transition-colors">
          {expanded ? "hide trace" : "agent trace"}
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
              {steps.map((a, i) => (
                <motion.div
                  key={a.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: revealed > i ? 1 : 0.35, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={cn(
                    "px-3 py-2.5 border-b border-[var(--color-hair)] last:border-b-0",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", a.color)} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">
                      {a.label}
                    </span>
                    <span className="font-mono text-[9px] text-[var(--color-ink-3)]">
                      {a.time}s
                    </span>
                    {agentIds[a.key] && (
                      <span className="font-mono text-[9px] text-[var(--color-ink-3)] truncate">
                        ERC-8004 #{agentIds[a.key]}
                      </span>
                    )}
                    <span className="ml-auto text-[var(--color-rust)]">
                      <SuccessCheck active={revealed > i} />
                    </span>
                  </div>
                  <div className="mt-1.5 pl-3.5 space-y-0.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                      tool · <span className="text-[var(--color-ink-2)]">{a.tool}</span>
                    </p>
                    <p className="font-serif text-[13px] text-[var(--color-ink-2)] leading-snug">
                      {a.rationale}
                    </p>
                  </div>
                </motion.div>
              ))}

              {payment && (
                <div className="px-3 py-2.5 border-t border-[var(--color-hair)] bg-[var(--color-paper-2)]/40">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                    tool · <span className="text-[var(--color-ink-2)]">x402_score_fee</span>
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

              <div className="px-3 py-2.5 border-t border-[var(--color-hair)]">
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                  next · <span className="text-[var(--color-ink-2)]">erc8183_license_job</span>
                  {" · "}USDC escrow · finality {"<"}1s
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
