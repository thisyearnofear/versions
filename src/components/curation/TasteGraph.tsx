"use client";

// MODULAR: Read-only taste-graph radar mini. Used by the feed and
// agent monitor to show the four-axis polygon (SOLO, VOCAL, ENERGY,
// TEMPO) for a single set of values. The interactive draggable
// version was removed when the human curator flow was deprecated.
//
// Geometry: 4 axes at the cardinal directions so the polygon reads
// as a compass. Each axis gets a 90° slice to itself. Energy and
// tempo values are 0–10 continuous on the radar (snapped at submit
// time in the backend — see lib/snap.ts).

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

export type TasteAxis = "solo" | "vocal" | "energy" | "tempo";

export interface TasteValues {
  solo: number;
  vocal: number;
  energy: number;
  tempo: number;
}

const MINI_AXES = [
  { id: "solo", label: "Solo", angle: -Math.PI / 2 },
  { id: "vocal", label: "Vocal", angle: 0 },
  { id: "energy", label: "Energy", angle: Math.PI / 2 },
  { id: "tempo", label: "Tempo", angle: Math.PI },
] as const;

const RING_FRACTIONS = [0.25, 0.5, 0.75, 1] as const;

export interface TasteGraphMiniProps {
  values: Partial<TasteValues>;
  size?: number;
  className?: string;
}

export function TasteGraphMini({ values, size = 120, className }: TasteGraphMiniProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 14;
  const reduce = useReducedMotion();

  const valueAt = (axisId: TasteAxis): number => {
    const v = Number(values[axisId]) || 0;
    return Math.max(0, Math.min(10, v)) / 10;
  };

  const point = (axis: (typeof MINI_AXES)[number], scale: number) => [
    cx + Math.cos(axis.angle) * r * scale,
    cy + Math.sin(axis.angle) * r * scale,
  ] as const;

  const ringPolygons = RING_FRACTIONS.map((s) =>
    MINI_AXES.map((a) => point(a, s).map((n) => n.toFixed(1)).join(",")).join(" "),
  );

  const valuePoints = MINI_AXES.map((a) =>
    point(a, valueAt(a.id)).map((n) => n.toFixed(1)).join(","),
  ).join(" ");

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }} aria-label="Taste graph">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
      >
        {ringPolygons.map((pts, i) => (
          <polygon key={`ring-${i}`} points={pts} fill="none" stroke="rgba(26,26,26,0.10)" strokeWidth={0.5} />
        ))}
        {MINI_AXES.map((a) => {
          const [x, y] = point(a, 1);
          return (
            <line
              key={`axis-${a.id}`}
              x1={cx}
              y1={cy}
              x2={x.toFixed(1)}
              y2={y.toFixed(1)}
              stroke="rgba(26,26,26,0.18)"
              strokeWidth={0.5}
            />
          );
        })}
        {/* MODULAR: taste radar wakes up analog-style via outer motion.g
            (scale 0.55 -> 1 + opacity 0 -> 1, 0.5s easeOutQuint) and
            then breathes perpetually via inner motion.polygon scale
            pulse 1 -> 1.04 -> 0.96 -> 1.02 -> 1 over 3.2s easeInOut,
            starting AND ending at 1 so the repeat-Infinity loop
            boundary is invisible. The 4 axis handles inherit the
            wake-up from the g (transform via SVG inheritance) but
            stay static after -- they ride without ringing. Both
            transform-box: fill-box lines anchor transform-origin to
            each element's own bounding box. Reduced-motion users
            (useReducedMotion) collapse the outer initial to match
            animate so the wake-up tween is skipped entirely; inner
            pulse is naturally static via the global MotionConfig. */}
        <motion.g
          initial={
            reduce
              ? { scale: 1, opacity: 1 }
              : { scale: 0.55, opacity: 0 }
          }
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: "50% 50%", transformBox: "fill-box" }}
        >
          <motion.polygon
            data-tg-polygon="1"
            points={valuePoints}
            fill="rgba(200,74,31,0.18)"
            stroke="var(--color-rust, #c84a1f)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            animate={{
              scale: [1, 1.07, 0.93, 1.04, 1],
            }}
            transition={{
              duration: 2.0,
              ease: "easeInOut",
              repeat: Infinity,
              repeatType: "loop",
              times: [0, 0.25, 0.5, 0.75, 1],
            }}
            style={{ transformOrigin: "50% 50%", transformBox: "fill-box" }}
          />
          {MINI_AXES.map((a) => {
            const [x, y] = point(a, valueAt(a.id));
            return (
              <circle
                key={`handle-${a.id}`}
                data-tg-axis={a.id}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={2}
                fill="var(--color-rust, #c84a1f)"
              />
            );
          })}
        </motion.g>
        {/* MODULAR: 4 axis labels wake up staggered 80ms apart, mirroring
            the AudioPlayer 5-phase stagger pattern applied to the 4
            actual axes (the TasteAxis type is solo/vocal/energy/tempo).
            Each label fades from opacity 0 -> 0.7 (matching the static
            fill alpha). Reduced-motion users collapse initial to match
            animate so labels appear at full alpha from first paint. */}
        {MINI_AXES.map((a, i) => {
          const [x, y] = point(a, 1.18);
          return (
            <motion.text
              key={`label-${a.id}`}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={8}
              letterSpacing="0.1em"
              fill="rgba(26,26,26,0.7)"
              initial={{ opacity: reduce ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: 0.32,
                delay: i * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {a.label.toUpperCase()}
            </motion.text>
          );
        })}
      </svg>
    </div>
  );
}

