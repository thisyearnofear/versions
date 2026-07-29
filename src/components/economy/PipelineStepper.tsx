"use client";

// MODULAR: horizontal pipeline stepper for a single submission.
// Derives stage states from the submission status + agent rating
// count so the judge sees the exact lifecycle position:
// Submit → Pay → Agent Review (3 agents) → Publish → Settle.

import { motion } from "framer-motion";

export type StageState = "done" | "active" | "upcoming" | "failed";

interface Stage {
  label: string;
  state: StageState;
  detail?: string;
}

export interface PipelineProps {
  status?: string;
  ratingCount?: number;
  paymentTxHash?: string | null;
}

const STATUS_ORDER = ["pending_payment", "awaiting_curation", "in_curation", "published"];

export function deriveStages({ status, ratingCount }: PipelineProps): Stage[] {
  const s = status ?? "pending_payment";
  const idx = STATUS_ORDER.indexOf(s);
  const ratings = ratingCount ?? 0;
  const rejected = s === "rejected";

  const submit: Stage = { label: "Submit", state: "done" };
  const pay: Stage =
    idx >= 1 || rejected
      ? { label: "Pay", state: "done" }
      : { label: "Pay", state: "active", detail: "awaiting x402 fee" };
  const review: Stage = rejected
    ? { label: "Review", state: "failed", detail: "rejected" }
    : idx >= 3
      ? { label: "Review", state: "done", detail: "3/3 agents" }
      : idx >= 1
        ? {
            label: "Review",
            state: idx === 2 ? "active" : "upcoming",
            detail: `${ratings}/3 agents`,
          }
        : { label: "Review", state: "upcoming" };
  const publish: Stage =
    idx >= 3
      ? { label: "Publish", state: "done" }
      : { label: "Publish", state: "upcoming" };
  const settle: Stage =
    idx >= 3
      ? { label: "Settle", state: "active", detail: "legs settling" }
      : { label: "Settle", state: "upcoming" };

  return [submit, pay, review, publish, settle];
}

const STATE_COLORS: Record<StageState, string> = {
  done: "var(--color-ink)",
  active: "var(--color-rust)",
  upcoming: "var(--color-ink-3)",
  failed: "var(--color-rust-dark, #8b2500)",
};

export function PipelineStepper(props: PipelineProps) {
  const stages = deriveStages(props);

  return (
    <div className="flex items-start gap-0 overflow-x-auto py-1" role="list" aria-label="Submission pipeline">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-start" role="listitem">
          {i > 0 && (
            <div
              className="h-px w-5 mt-[7px] shrink-0"
              style={{
                backgroundColor:
                  stage.state === "upcoming"
                    ? "var(--color-hair)"
                    : "var(--color-ink-3)",
              }}
            />
          )}
          <motion.div
            className="flex flex-col items-center min-w-[56px]"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
          >
            <span
              className="w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center"
              style={{
                borderColor: STATE_COLORS[stage.state],
                backgroundColor:
                  stage.state === "done"
                    ? STATE_COLORS[stage.state]
                    : stage.state === "failed"
                      ? STATE_COLORS[stage.state]
                      : "transparent",
              }}
            >
              {stage.state === "done" && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1 4l2 2 4-4" stroke="var(--color-paper)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {stage.state === "failed" && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="var(--color-paper)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
              {stage.state === "active" && (
                <span className="w-[6px] h-[6px] rounded-full bg-[var(--color-rust)] animate-pulse" />
              )}
            </span>
            <span
              className="font-mono text-[9px] uppercase tracking-[0.12em] mt-1.5 text-center leading-tight whitespace-nowrap"
              style={{ color: STATE_COLORS[stage.state] }}
            >
              {stage.label}
            </span>
            {stage.detail && (
              <span className="font-mono text-[8px] tracking-[0.1em] text-[var(--color-ink-3)] text-center leading-tight">
                {stage.detail}
              </span>
            )}
          </motion.div>
        </div>
      ))}
    </div>
  );
}
