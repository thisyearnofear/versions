// MODULAR: Shared SVG sanitizer for cover art. FeedView's inline
// sanitize() was the original home; extracting it here lets every
// surface (FeedView, RatingCover, …) render covers through the SAME
// allowlist so the art can't drift between copies.
//
// SSR-safe: during prerender DOMPurify has no `window` and its
// .sanitize is unavailable, so the server path returns the cover
// as-is — covers are either server-validated DB rows (Zod: starts
// with <svg, ≤16 KB) or our own generated SVGs (cover-gen, whose
// title is escapeHtml'd), never untrusted input. The client always
// sanitizes before injecting.
//
// The allowlist covers both the cover-gen generator output (rect,
// line, circle, path with stroke-opacity / fill-opacity /
// preserveAspectRatio / aria-label) and legacy client-generated
// covers (g, polygon, defs, linearGradient, text, span).

import DOMPurify from "dompurify";

const SVG_TAGS = [
  "svg",
  "path",
  "circle",
  "polygon",
  "rect",
  "line",
  "text",
  "g",
  "defs",
  "linearGradient",
  "stop",
  "span",
];

const SVG_ATTRS = [
  "d",
  "viewBox",
  "width",
  "height",
  "preserveAspectRatio",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "strokeWidth",
  "stroke-width",
  "strokeLinejoin",
  "stroke-linejoin",
  "cx",
  "cy",
  "r",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "textAnchor",
  "dominantBaseline",
  "fontFamily",
  "fontSize",
  "letterSpacing",
  "class",
  "data-tg-polygon",
  "data-tg-axis",
  "aria-hidden",
  "aria-label",
  "xmlns",
  "role",
];

export function sanitizeCoverSvg(unsafe: string): string {
  if (typeof window === "undefined") return unsafe;
  return DOMPurify.sanitize(unsafe, {
    ALLOWED_TAGS: SVG_TAGS,
    ALLOWED_ATTR: SVG_ATTRS,
  });
}
