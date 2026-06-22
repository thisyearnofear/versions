"use client";

// MODULAR: Taste-graph radar. Two consumers, one module:
//   1. <TasteGraphMini />   — read-only mini for the feed (≤120px)
//   2. <TasteGraph />       — large draggable polygon for the rate
//      scorecard (~320px). The same primitive drawn at two scales.
//
// Geometry: 4 axes at the cardinal directions (SOLO top, VOCAL right,
// ENERGY bottom, TEMPO left) so the polygon reads as a compass and
// each axis gets a 90° slice to itself. Energy + tempo are
// continuous on the radar (0–10) and snap to the nearest discrete
// value at submit time (see lib/snap.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type TasteAxis = "solo" | "vocal" | "energy" | "tempo";

export interface TasteValues {
  solo: number;
  vocal: number;
  energy: number;
  tempo: number;
}

const INTERACTIVE_AXES = [
  { id: "solo", label: "SOLO", angle: -Math.PI / 2, axisIndex: 0 },
  { id: "vocal", label: "VOCAL", angle: 0, axisIndex: 1 },
  { id: "energy", label: "ENERGY", angle: Math.PI / 2, axisIndex: 2 },
  { id: "tempo", label: "TEMPO", angle: Math.PI, axisIndex: 3 },
] as const;

const MINI_AXES = [
  { id: "solo", label: "Solo", angle: -Math.PI / 2 },
  { id: "vocal", label: "Vocal", angle: 0 },
  { id: "energy", label: "Energy", angle: Math.PI / 2 },
  { id: "tempo", label: "Tempo", angle: Math.PI },
] as const;

const RING_FRACTIONS = [0.25, 0.5, 0.75, 1] as const;

// ────────────────────────────────────────────────────────────────────────
// Mini radar (read-only, for the feed)
// ────────────────────────────────────────────────────────────────────────

export interface TasteGraphMiniProps {
  values: Partial<TasteValues>;
  size?: number;
  className?: string;
}

export function TasteGraphMini({ values, size = 120, className }: TasteGraphMiniProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 14;

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
        <polygon
          data-tg-polygon="1"
          points={valuePoints}
          fill="rgba(200,74,31,0.18)"
          stroke="var(--color-rust, #c84a1f)"
          strokeWidth={1.5}
          strokeLinejoin="round"
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
        {MINI_AXES.map((a) => {
          const [x, y] = point(a, 1.18);
          return (
            <text
              key={`label-${a.id}`}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={8}
              letterSpacing="0.1em"
              fill="rgba(26,26,26,0.7)"
            >
              {a.label.toUpperCase()}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Interactive radar (draggable, for the rate scorecard)
// ────────────────────────────────────────────────────────────────────────

export interface TasteGraphProps {
  values: TasteValues;
  onChange: (values: TasteValues) => void;
  size?: number;
  className?: string;
}

const VIEWBOX_W = 384;
const VIEWBOX_H = 384;
const VIEWBOX_OX = -32;
const VIEWBOX_OY = -32;

export function TasteGraph({ values, onChange, size = 320, className }: TasteGraphProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 32;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const point = useCallback(
    (axis: (typeof INTERACTIVE_AXES)[number], value: number) => {
      const scale = value / 10;
      return [cx + Math.cos(axis.angle) * r * scale, cy + Math.sin(axis.angle) * r * scale] as const;
    },
    [cx, cy, r],
  );

  const valuePoints = useMemo(
    () => INTERACTIVE_AXES.map((a) => point(a, values[a.id]).map((n) => n.toFixed(1)).join(",")).join(" "),
    [point, values],
  );

  const setAxisValue = useCallback(
    (axisId: TasteAxis, value: number) => {
      const clamped = clamp(value, 0, 10, 5);
      if (values[axisId] === clamped) return;
      onChange({ ...values, [axisId]: clamped });
    },
    [onChange, values],
  );

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      if (!dragging) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const axis = INTERACTIVE_AXES.find((a) => a.id === dragging);
      if (!axis) return;
      const vbX = ((ev.clientX - rect.left) / rect.width) * VIEWBOX_W + VIEWBOX_OX;
      const vbY = ((ev.clientY - rect.top) / rect.height) * VIEWBOX_H + VIEWBOX_OY;
      const x = vbX - cx;
      const y = vbY - cy;
      const proj = x * Math.cos(axis.angle) + y * Math.sin(axis.angle);
      setAxisValue(axis.id, (proj / r) * 10);
    },
    [cx, cy, dragging, r, setAxisValue],
  );

  const onPointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging, onPointerMove, onPointerUp]);

  return (
    <div className={cn("w-full", className)} style={{ maxWidth: size }}>
      <svg
        ref={svgRef}
        viewBox={`${VIEWBOX_OX} ${VIEWBOX_OY} ${VIEWBOX_W} ${VIEWBOX_H}`}
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Taste graph (drag the dots to rate)"
        className="block w-full h-auto"
      >
        {/* Background rings */}
        {RING_FRACTIONS.map((s) => (
          <polygon
            key={`ring-${s}`}
            points={INTERACTIVE_AXES.map((a) => point(a, s * 10).map((n) => n.toFixed(1)).join(",")).join(" ")}
            fill="none"
            stroke="rgba(26,26,26,0.10)"
            strokeWidth={0.5}
          />
        ))}
        {/* Axes */}
        {INTERACTIVE_AXES.map((a) => {
          const [x, y] = point(a, 10);
          return (
            <line
              key={`axis-${a.id}`}
              x1={cx}
              y1={cy}
              x2={x.toFixed(1)}
              y2={y.toFixed(1)}
              stroke="rgba(26,26,26,0.24)"
              strokeWidth={0.6}
            />
          );
        })}
        {/* Discrete tags (L/S/H + D/L/R) for energy + tempo */}
        {INTERACTIVE_AXES.filter((a) => a.id === "energy" || a.id === "tempo").map((a) => {
          const tags: Array<{ value: number; label: string }> =
            a.id === "energy"
              ? [
                  { value: 0, label: "L" },
                  { value: 5, label: "S" },
                  { value: 10, label: "H" },
                ]
              : [
                  { value: 0, label: "D" },
                  { value: 5, label: "L" },
                  { value: 10, label: "R" },
                ];
          return tags.map((d) => {
            const [x, y] = point(a, d.value);
            return (
              <g key={`tag-${a.id}-${d.label}`}>
                <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r={2.5} fill="rgba(26,26,26,0.5)" />
                <text
                  x={(cx + Math.cos(a.angle) * (r + 14)).toFixed(1)}
                  y={(cy + Math.sin(a.angle) * (r + 14)).toFixed(1)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize={9}
                  letterSpacing="0.1em"
                  fill="rgba(26,26,26,0.6)"
                >
                  {d.label}
                </text>
              </g>
            );
          });
        })}
        {/* Value polygon */}
        <polygon
          points={valuePoints}
          fill="rgba(200,74,31,0.18)"
          stroke="var(--color-rust, #c84a1f)"
          strokeWidth={2}
          strokeLinejoin="round"
          pointerEvents="none"
        />
        {/* Axis labels */}
        {INTERACTIVE_AXES.map((a) => {
          const cosA = Math.cos(a.angle);
          const sinA = Math.sin(a.angle);
          const tx = cx + cosA * (r + 22);
          const ty = cy + sinA * (r + 22);
          const anchor = Math.abs(cosA) < 0.3 ? "middle" : cosA > 0 ? "start" : "end";
          const dx = anchor === "start" ? 6 : anchor === "end" ? -6 : 0;
          return (
            <text
              key={`label-${a.id}`}
              x={(tx + dx).toFixed(1)}
              y={ty.toFixed(1)}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={10}
              letterSpacing="0.18em"
              fontWeight={600}
              fill="rgba(26,26,26,0.85)"
              pointerEvents="none"
            >
              {a.label}
            </text>
          );
        })}
        {/* Draggable handles (hit-area + dot) */}
        {INTERACTIVE_AXES.map((a) => {
          const [x, y] = point(a, values[a.id]);
          return (
            <g key={`handle-${a.id}`}>
              <circle
                data-handle={a.id}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={36}
                fill="transparent"
                style={{ cursor: "grab", touchAction: "none" }}
                onPointerDown={(ev) => {
                  ev.preventDefault();
                  (ev.target as Element).setPointerCapture?.(ev.pointerId);
                  setDragging(a.id);
                }}
              />
              <circle
                data-handle={a.id}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={dragging === a.id ? 10 : 8}
                fill="var(--color-paper, #f4efe5)"
                stroke="var(--color-rust, #c84a1f)"
                strokeWidth={2}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
