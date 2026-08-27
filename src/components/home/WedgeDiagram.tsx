"use client";

// MODULAR: the wedge, drawn instead of described. One SVG that
// illustrates the whole pipeline — a brief fans out to three agent
// lenses, converges on the best-fitting take, and settles in USDC on
// Arc. Nodes pop in sequence on scroll, connectors self-draw, and a
// dashed "flow" runs the main path (skipped under reduced-motion).
// Replaces what used to be three paragraphs of explainer copy.

import { motion, useReducedMotion } from "framer-motion";
import { DrawPath, EASE_OUT } from "@/components/ui/motion";

const INK = "var(--color-ink)";
const INK3 = "var(--color-ink-3)";
const RUST = "var(--color-rust)";

interface Node {
  x: number;
  y: number;
  label: string;
  delay: number;
  accent?: boolean;
  glyph: "brief" | "mix" | "wave" | "target" | "match" | "coin";
}

const NODES: Node[] = [
  { x: 92, y: 120, label: "the brief", delay: 0.0, glyph: "brief" },
  { x: 316, y: 48, label: "production", delay: 0.25, glyph: "mix" },
  { x: 316, y: 120, label: "performance", delay: 0.35, glyph: "wave" },
  { x: 316, y: 192, label: "market", delay: 0.45, glyph: "target" },
  { x: 520, y: 120, label: "best fit", delay: 0.7, accent: true, glyph: "match" },
  { x: 668, y: 120, label: "settled · USDC", delay: 0.95, glyph: "coin" },
];

// Fan-out from brief → agents, converge agents → match, then → settlement.
const LINKS = [
  { d: "M 118 112 C 190 100, 240 62, 290 52", delay: 0.15 },
  { d: "M 118 120 L 288 120", delay: 0.2 },
  { d: "M 118 128 C 190 140, 240 178, 290 188", delay: 0.25 },
  { d: "M 342 52 C 400 62, 440 100, 468 112", delay: 0.55 },
  { d: "M 344 120 L 468 120", delay: 0.6 },
  { d: "M 342 188 C 400 178, 440 140, 468 128", delay: 0.65 },
  { d: "M 572 120 L 616 120", delay: 0.85 },
];

function Glyph({ glyph, x, y, accent }: { glyph: Node["glyph"]; x: number; y: number; accent?: boolean }) {
  const c = accent ? RUST : INK;
  switch (glyph) {
    case "brief":
      return (
        <g stroke={c} strokeWidth="1.5" fill="none">
          <rect x={x - 11} y={y - 13} width="22" height="26" rx="3" />
          <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y - 5} />
          <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
          <line x1={x - 5} y1={y + 5} x2={x + 2} y2={y + 5} />
        </g>
      );
    case "mix":
      return (
        <g stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round">
          <line x1={x - 8} y1={y - 8} x2={x - 8} y2={y + 8} />
          <line x1={x} y1={y - 8} x2={x} y2={y + 8} />
          <line x1={x + 8} y1={y - 8} x2={x + 8} y2={y + 8} />
          <circle cx={x - 8} cy={y + 2} r="2.4" fill={c} stroke="none" />
          <circle cx={x} cy={y - 4} r="2.4" fill={c} stroke="none" />
          <circle cx={x + 8} cy={y + 4} r="2.4" fill={c} stroke="none" />
        </g>
      );
    case "wave":
      return (
        <g stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round">
          <line x1={x - 10} y1={y - 3} x2={x - 10} y2={y + 3} />
          <line x1={x - 5} y1={y - 7} x2={x - 5} y2={y + 7} />
          <line x1={x} y1={y - 10} x2={x} y2={y + 10} />
          <line x1={x + 5} y1={y - 6} x2={x + 5} y2={y + 6} />
          <line x1={x + 10} y1={y - 2} x2={x + 10} y2={y + 2} />
        </g>
      );
    case "target":
      return (
        <g stroke={c} strokeWidth="1.5" fill="none">
          <circle cx={x} cy={y} r="10" />
          <circle cx={x} cy={y} r="5" />
          <circle cx={x} cy={y} r="1.6" fill={c} stroke="none" />
        </g>
      );
    case "match":
      return (
        <g stroke={RUST} strokeWidth="1.5" fill="none">
          <rect x={x - 13} y={y - 13} width="26" height="26" rx="5" fill="var(--color-rust-soft)" />
          <path d={`M ${x - 5} ${y} L ${x - 1} ${y + 4} L ${x + 6} ${y - 4}`} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "coin":
      return (
        <g stroke={c} strokeWidth="1.5" fill="none">
          <circle cx={x} cy={y} r="11" />
          <path d={`M ${x - 4} ${y - 5} L ${x} ${y} L ${x - 4} ${y + 5} M ${x} ${y} L ${x + 5} ${y}`} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
  }
}

export function WedgeDiagram() {
  const reduce = useReducedMotion();
  return (
    <div className="card-surface mx-auto w-full max-w-3xl px-2 py-4 sm:px-6" role="img"
      aria-label="Diagram: a placement brief is scored by three agent lenses — production, performance, market — converging on the best-fitting take, then settled in USDC on Arc."
    >
      <svg viewBox="0 0 720 240" className="h-auto w-full" aria-hidden="true">
        {/* Connectors draw themselves in order */}
        {LINKS.map((l) => (
          <DrawPath key={l.d} d={l.d} delay={l.delay} className="text-[var(--color-ink-3)]" strokeWidth={1.4} />
        ))}
        {/* Flow: dashes travel the links (skipped for reduced motion) */}
        {!reduce &&
          LINKS.map((l, i) => (
            <motion.path
              key={`flow-${l.d}`}
              d={l.d}
              fill="none"
              stroke={RUST}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeDasharray="2 8"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 0.8 }}
              viewport={{ once: true }}
              animate={{ strokeDashoffset: [0, -40] }}
              transition={{
                opacity: { delay: l.delay + 0.9, duration: 0.4 },
                strokeDashoffset: { repeat: Infinity, duration: 1.6, ease: "linear", delay: i * 0.2 },
              }}
            />
          ))}
        {/* Pulsing glow ring on the best-fit node — the decision moment. */}
        {!reduce && (
          <motion.circle
            cx={520}
            cy={120}
            r="18"
            fill="none"
            stroke={RUST}
            strokeWidth="1.5"
            initial={{ opacity: 0.6, scale: 0.9 }}
            animate={{ opacity: [0.6, 0, 0.6], scale: [0.9, 1.8, 0.9] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            style={{ transformOrigin: "520px 120px" }}
          />
        )}
        {/* Nodes pop in sequence */}
        {NODES.map((n) => (
          <motion.g
            key={n.label}
            initial={{ opacity: 0, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: n.delay, duration: 0.45, ease: EASE_OUT }}
            style={{ transformOrigin: `${n.x}px ${n.y}px` }}
          >
            <Glyph glyph={n.glyph} x={n.x} y={n.y} accent={n.accent} />
            <text
              x={n.x}
              y={n.y + 34}
              textAnchor="middle"
              fill={n.accent ? RUST : INK3}
              fontSize="10"
              fontFamily="var(--font-mono)"
              letterSpacing="0.12em"
              style={{ textTransform: "uppercase" }}
            >
              {n.label}
            </text>
          </motion.g>
        ))}
      </svg>
    </div>
  );
}
