"use client";

// MODULAR: Shared rating-driven cover thumbnail. Renders
// generateRatingCover's deterministic SVG (valence → palette,
// solo/vocal → amplitude, tempo → density, mood tags → rings) at an
// arbitrary box size, so every surface — feed rows, the landing
// gallery, the artist dashboard, and the tip hover-card — shows the
// SAME art for the SAME track.
//
// Sanitization routes through the shared cover-sanitize module (the
// same allowlist FeedView uses), so opacity styling and aria-label
// survive on every surface.

import { generateRatingCover, type RatingCoverInput } from "@/lib/cover-gen";
import { sanitizeCoverSvg } from "@/lib/cover-sanitize";
import { cn } from "@/lib/utils";

export function RatingCover({
  input,
  size = 48,
  className,
}: {
  input: RatingCoverInput;
  size?: number;
  className?: string;
}) {
  // MODULAR: deterministic pure function — regenerate per render is
  // negligible (a few dozen string ops), so no memo needed.
  const svg = generateRatingCover(input);
  return (
    <div
      className={cn("shrink-0 overflow-hidden", className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: sanitizeCoverSvg(svg) }}
    />
  );
}
