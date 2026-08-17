"use client";

// MODULAR: Scene card — a procedural storyboard panel generated from the
// agents' parsed brief (scene_tags / instruments / emotional_arcs /
// audience_summary), so a supervisor can SEE the scene the ranked tracks are
// being matched against before judging sync-fit. Zero marginal cost: the
// panel is composed from signals the ranking agents already produce (see
// src/lib/scene-visual.ts), so it doubles as agentic proof. Rendered beside
// the top recommendation with the suggested track named below it.

import { useMemo } from "react";
import { sanitizeCoverSvg } from "@/lib/cover-sanitize";
import { generateSceneCardSvg } from "@/lib/scene-visual";

export interface SceneCardBrief {
  scene_tags: string[];
  instruments: string[];
  emotional_arcs: string[];
  audience_summary: string;
}

export function SceneCard({
  brief,
  briefText,
  trackTitle,
  artistName,
}: {
  brief: SceneCardBrief;
  briefText?: string;
  trackTitle: string;
  artistName: string;
}) {
  // MODULAR: the generator only emits tags/attrs the shared sanitizer allows,
  // and escapeHtml's the aria-label — sanitizeCoverSvg is the belt-and-
  // suspenders pass (no-op during SSR, like cover-gen).
  const svg = useMemo(
    () =>
      sanitizeCoverSvg(
        generateSceneCardSvg({
          briefText,
          sceneTags: brief.scene_tags,
          instruments: brief.instruments,
          emotionalArcs: brief.emotional_arcs,
          audienceSummary: brief.audience_summary,
        }),
      ),
    [brief, briefText],
  );

  const topScene = brief.scene_tags[0] ?? null;
  const instruments = brief.instruments.slice(0, 4);

  return (
    <section
      aria-label={`Scene card for ${trackTitle} by ${artistName}`}
      className="mb-4 border border-[var(--color-hair-strong)] bg-[var(--color-paper)]"
    >
      <p className="border-b border-[var(--color-hair)] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-rust)]">
        Scene card · generated from the current brief
      </p>
      <div className="p-4">
        <div
          className="w-full overflow-hidden border border-[var(--color-hair)]"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {topScene && (
            <span className="bg-[var(--color-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-paper)]">
              {topScene}
            </span>
          )}
          {instruments.map((inst) => (
            <span
              key={inst}
              className="border border-[var(--color-hair-strong)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]"
            >
              {inst}
            </span>
          ))}
        </div>
        {brief.audience_summary && (
          <p className="mt-2 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
            {brief.audience_summary}
          </p>
        )}
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
          Suggested track · {trackTitle} · {artistName}
        </p>
      </div>
    </section>
  );
}
