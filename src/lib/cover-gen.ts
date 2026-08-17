// MODULAR: Deterministic cover art generated from a track's
// taste-graph ratings. Every published version gets a unique,
// algorithmic, on-brand cover that literally visualizes the agent
// consensus:
//
//   - valence   → palette (dark / neutral / bright)
//   - solo/vocal → waveform amplitude
//   - energy    → amplitude boost (higher energy → taller wave)
//   - tempo     → bar density (dragging = sparse, rushing = dense)
//   - mood tags → accent rings count + seeded placement
//   - title     → PRNG seed (same track always renders the same art)
//
// Pure + deterministic + dependency-free (only deriveValence for the
// tag→valence mapping, also pure), so it is unit-testable, safe in
// Node (seed script) and in the browser (FeedView fallback), and
// needs no audio decoding like useCoverFromAudio.
//
// Output passes through DOMPurify in FeedView — only tags/attrs the
// existing sanitizer allows are emitted (svg/rect/path/circle/line/g).

import { deriveValence } from "@/services/taste-graph";
import { escapeHtml } from "@/lib/utils";

export interface RatingCoverInput {
  title: string;
  avgSolo?: number | null;
  avgVocal?: number | null;
  energy?: string | null; // lower|same|higher
  tempo?: string | null; // dragging|locked|rushing
  valence?: string | null; // explicit override; else derived from tags
  moodTags?: string[] | null;
}

export interface RatingCoverOptions {
  size?: number;
}

// ── Seeded PRNG (mulberry32) ───────────────────────────
// MODULAR: deterministic per-title randomness so the art is stable
// across renders/servers without storing anything extra.
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Palette by valence ─────────────────────────────────
// MODULAR: three ink-on-paper palettes. Dark = deep indigo night
// register, neutral = the cream/ink/rust house palette, bright =
// warm gold morning register. Each has bg + fg + accent.
export interface Palette {
  bg: string;
  fg: string;
  accent: string;
}

export const PALETTES: Record<string, Palette> = {
  dark: { bg: "#23233a", fg: "#f4efe5", accent: "#c84a1f" },
  neutral: { bg: "#f4efe5", fg: "#1a1a1a", accent: "#c84a1f" },
  bright: { bg: "#f2e3c3", fg: "#1a1a1a", accent: "#a33818" },
};

export function paletteFor(valence: string | null | undefined): Palette {
  return PALETTES[valence ?? ""] ?? PALETTES.neutral;
}

// ── Waveform amplitude ─────────────────────────────────
function amplitudeFor(
  solo: number | null | undefined,
  vocal: number | null | undefined,
  energy: string | null | undefined,
): number {
  const avg = (solo ?? 5) + (vocal ?? 5);
  let amp = (avg / 20) * 0.85 + 0.15; // 5/5 → 0.575, 10/10 → 1.0
  if (energy === "higher") amp = Math.min(1, amp + 0.12);
  if (energy === "lower") amp = Math.max(0.2, amp - 0.12);
  return amp;
}

// ── Bar density by tempo ───────────────────────────────
function barsFor(tempo: string | null | undefined): number {
  switch (tempo) {
    case "dragging": return 18;
    case "rushing": return 40;
    default: return 28; // locked / unknown
  }
}

/**
 * MODULAR: generate the rating cover SVG string. Deterministic for
 * the same (title, ratings) input. Returns a complete <svg> element
 * with role="img" + aria-label so it is announced, not just drawn.
 */
export function generateRatingCover(
  input: RatingCoverInput,
  options: RatingCoverOptions = {},
): string {
  const size = options.size ?? 200;
  const seed = hashString(input.title || "untitled");
  const rand = mulberry32(seed);
  const valence = input.valence ?? deriveValence(input.moodTags ?? []) ?? "neutral";
  const pal = paletteFor(valence);

  const amp = amplitudeFor(input.avgSolo, input.avgVocal, input.energy);
  const bars = barsFor(input.tempo);

  const mid = size / 2;
  const inset = size * 0.08;
  const drawW = size - inset * 2;
  const maxH = mid - inset;

  // Waveform path — symmetric around the mid-line like peaksToSvg.
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = 0; i < bars; i++) {
    const x = inset + (i / Math.max(1, bars - 1)) * drawW;
    // MODULAR: deterministic per-bar wobble so the wave reads
    // organic, not a perfect sine — but stable per track.
    const wobble = 0.55 + rand() * 0.9;
    const h = maxH * amp * wobble;
    upper.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${(mid - h).toFixed(1)}`);
    lower.push(`${x.toFixed(1)},${(mid + h).toFixed(1)}`);
  }
  const path = upper.concat(lower.slice().reverse()).join(" ");

  // Accent rings — count scales with mood-tag variety, capped at 3.
  const ringCount = Math.min(3, (input.moodTags?.length ?? 1) || 1);
  let rings = "";
  for (let r = 0; r < ringCount; r++) {
    const rx = inset + rand() * drawW;
    const ry = inset * 1.2 + rand() * (size - inset * 2.4);
    const radius = size * (0.05 + rand() * 0.09);
    const ring = rand() > 0.5 ? "circle" : "line";
    if (ring === "circle") {
      rings += `<circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="${radius.toFixed(1)}" fill="none" stroke="${pal.accent}" stroke-opacity="0.5" stroke-width="1.2"/>`;
    } else {
      const lx2 = rx + size * 0.06;
      rings += `<line x1="${rx.toFixed(1)}" y1="${(ry - radius).toFixed(1)}" x2="${lx2.toFixed(1)}" y2="${(ry + radius).toFixed(1)}" stroke="${pal.accent}" stroke-opacity="0.4" stroke-width="1"/>`;
    }
  }

  const label = input.title || "untitled";
  // MODULAR: titles are user-submitted metadata — escape before
  // interpolating into the aria-label so a hostile title can't break
  // out of the attribute (the SVG reaches dangerouslySetInnerHTML,
  // and the SSR sanitize path returns raw markup).
  const safeLabel = escapeHtml(label);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cover art for ${safeLabel}">` +
    `<rect width="${size}" height="${size}" fill="${pal.bg}"/>` +
    `<line x1="0" y1="${mid.toFixed(1)}" x2="${size}" y2="${mid.toFixed(1)}" ` +
    `stroke="${pal.fg}" stroke-opacity="0.12" stroke-width="0.5"/>` +
    rings +
    `<path d="${path} Z" fill="${pal.fg}" fill-opacity="0.28" stroke="${pal.accent}" stroke-width="1.1"/>` +
    `</svg>`
  );
}
