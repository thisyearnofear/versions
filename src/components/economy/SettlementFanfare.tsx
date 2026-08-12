"use client";

// MODULAR: shared settlement climax. Licensing and tipping both end in
// the same proof moment: money moved (or was recorded by the deterministic
// demo adapter), the recipient is named, and the next state is legible.
// The receipt stays visible as an editorial paper trail; only its entrance
// is theatrical. Audio follows the shared sound toggle and motion follows
// the app-wide reduced-motion preference.

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { isSoundEnabled, playSettlementChime } from "@/lib/audio-feedback";
import { jobUrl, shortHash, txUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";

export interface SettlementFanfareProps {
  kind: "license" | "tip";
  amountUsdc: string;
  mock: boolean;
  txHash?: string | null;
  title?: string | null;
  recipientLabel?: string | null;
  jobId?: string | null;
  onDismiss?: () => void;
  className?: string;
}

export function SettlementFanfare({
  kind,
  amountUsdc,
  mock,
  txHash,
  title,
  recipientLabel,
  jobId,
  onDismiss,
  className,
}: SettlementFanfareProps) {
  const reduceMotion = useReducedMotion();
  const confirmationKey = `${kind}:${txHash ?? amountUsdc}:${jobId ?? ""}`;
  const playedForRef = useRef<string | null>(null);

  useEffect(() => {
    // MODULAR: the parent may re-render while the license list refreshes;
    // key the chime to the actual receipt so a refresh cannot replay it.
    if (playedForRef.current === confirmationKey) return;
    playedForRef.current = confirmationKey;
    if (isSoundEnabled()) playSettlementChime();
  }, [confirmationKey]);

  const isLicense = kind === "license";
  const headline = isLicense
    ? mock
      ? "License simulated."
      : "License cleared."
    : mock
      ? "Tip recorded."
      : "Tip landed.";
  const detail = isLicense
    ? mock
      ? "Demo path complete — no on-chain funds moved."
      : "The usage right is now attached to this take."
    : mock
      ? "Demo path complete — no on-chain funds moved."
      : "A direct signal to the artist, settled in USDC.";
  const statusLabel = mock ? "Demo only · no funds moved" : "Confirmed on Arc";

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.section
        key={confirmationKey}
        role="status"
        aria-live="polite"
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "relative isolate overflow-hidden border border-[var(--color-rust)] bg-[var(--color-paper-2)] px-4 py-4",
          "shadow-[3px_3px_0_rgba(157,58,30,0.12)]",
          className,
        )}
      >
        {!reduceMotion && (
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, x: "50%", y: "50%", scale: 0 }}
                animate={{
                  opacity: [0, 0.8, 0],
                  x: `${[12, 28, 50, 72, 88, 62][i]}%`,
                  y: `${[25, 72, 18, 78, 35, 88][i]}%`,
                  scale: [0, 1, 0.7],
                  rotate: [0, 45, 90],
                }}
                transition={{ duration: 0.9, delay: i * 0.035, ease: "easeOut" }}
                className="absolute h-1.5 w-1.5 bg-[var(--color-rust)]"
              />
            ))}
          </div>
        )}

        <div className="flex items-start gap-3">
          <motion.span
            initial={reduceMotion ? false : { scale: 0.4, rotate: -18, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{
              delay: reduceMotion ? 0 : 0.12,
              duration: 0.45,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={cn(
              "mt-0.5 grid h-8 w-8 shrink-0 place-items-center border-2",
              mock
                ? "border-dashed border-[var(--color-rust)] text-[var(--color-rust)]"
                : "border-[var(--color-rust)] bg-[var(--color-rust)] text-[var(--color-paper)]",
            )}
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2.5 7.2 5.5 10l6-6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-rust)]">
                {isLicense ? "License settlement" : "Artist tip"}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                {statusLabel}
              </span>
            </div>
            <h3 className="mt-1 font-serif text-lg font-black leading-tight text-[var(--color-ink)]">
              {headline}
            </h3>
            <p className="mt-1 font-serif text-sm leading-snug text-[var(--color-ink-2)]">
              {detail}
              {title ? <span className="text-[var(--color-ink)]"> {title}</span> : null}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--color-ink-2)]">
              <span className="font-medium text-[var(--color-rust)]">${amountUsdc} USDC</span>
              {recipientLabel && <span>{recipientLabel}</span>}
              {jobId && (
                <a
                  href={jobUrl(jobId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-rust)] hover:underline"
                >
                  job #{jobId} ↗
                </a>
              )}
              {!mock && txHash && (
                <a
                  href={txUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-rust)] hover:underline"
                >
                  receipt {shortHash(txHash)} ↗
                </a>
              )}
            </div>
          </div>

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss settlement confirmation"
              className="shrink-0 font-mono text-sm leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
            >
              ×
            </button>
          )}
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
