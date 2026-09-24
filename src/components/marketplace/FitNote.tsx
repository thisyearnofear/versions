"use client";

// Component grammar (docs/interface.md §4.3): the fit rationale reads as
// prose first. The raw ranking score never becomes the headline — it stays
// available on hover for the operator who wants it.

import { cn } from "@/lib/utils";

export function FitNote({
  whyFits,
  tags,
  fitScore,
  className,
}: {
  whyFits?: string[] | null;
  tags?: string[] | null;
  fitScore?: number | null;
  className?: string;
}) {
  const prose = (whyFits ?? [])
    .map((w) => w.replace(/^tag:\s*/i, "").trim())
    .filter(Boolean);
  const fallback = (tags ?? []).slice(0, 4);
  const line = prose.length > 0 ? prose.slice(0, 3) : fallback;
  if (line.length === 0) return null;

  const scoreLabel =
    fitScore != null && Number.isFinite(fitScore)
      ? `Match score ${fitScore.toFixed(2)} — ranking for the current query, not a quality rating.`
      : undefined;

  return (
    <p
      className={cn("font-serif text-[13px] leading-snug text-[var(--color-ink-2)]", className)}
      title={scoreLabel}
    >
      {prose.length > 0 ? `Fits: ${line.join(" · ")}` : line.join(" · ")}
    </p>
  );
}
