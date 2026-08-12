"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const JOURNEYS = {
  artist: ["Submit", "Pay", "Review", "Publish", "Settle"],
  supervisor: ["Brief", "Match", "Shortlist", "License", "Settle"],
} as const;

export type JourneyVariant = keyof typeof JOURNEYS;
export type JourneyStage = (typeof JOURNEYS)[JourneyVariant][number];

export function JourneyRail({
  variant,
  active,
  className,
}: {
  variant: JourneyVariant;
  active: JourneyStage;
  className?: string;
}) {
  const stages = JOURNEYS[variant];
  const activeIndex = (stages as readonly string[]).indexOf(active);

  return (
    <ol
      aria-label={`${variant === "artist" ? "Artist" : "Supervisor"} journey`}
      className={cn("flex flex-wrap items-center gap-y-2", className)}
    >
      {stages.map((stage, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li key={stage} className="flex items-center">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "mx-2 h-px w-4 sm:w-7",
                  index <= activeIndex ? "bg-[var(--color-rust)]" : "bg-[var(--color-hair-strong)]",
                )}
              />
            )}
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.22 }}
              className="flex items-center gap-1.5"
              aria-current={current ? "step" : undefined}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border font-mono text-[8px]",
                  current && "border-[var(--color-rust)] bg-[var(--color-rust)] text-[var(--color-paper)]",
                  done && "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]",
                  !current && !done && "border-[var(--color-hair-strong)] text-[var(--color-ink-3)]",
                )}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={cn(
                  "font-mono text-[9px] uppercase tracking-[0.12em]",
                  current && "text-[var(--color-rust)]",
                  done && "text-[var(--color-ink-2)]",
                  !current && !done && "text-[var(--color-ink-3)]",
                )}
              >
                {stage}
              </span>
            </motion.div>
          </li>
        );
      })}
    </ol>
  );
}
