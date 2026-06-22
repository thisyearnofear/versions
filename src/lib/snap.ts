// MODULAR: discrete-value snap helpers for the energy + tempo axes.
// The radar is continuous (0-10) but the server validates against
// the discrete labels: lower / same / higher + dragging / locked / rushing.
// The bands are centred on 2/5/8 with a half-width of ~1.7, matching
// the L/S/H + D/L/R dots on the radar.

const ENERGY_SNAP = [
  { max: 3.4, value: "lower" as const },
  { max: 6.7, value: "same" as const },
  { max: 11, value: "higher" as const },
];
const TEMPO_SNAP = [
  { max: 3.4, value: "dragging" as const },
  { max: 6.7, value: "locked" as const },
  { max: 11, value: "rushing" as const },
];

export function snapEnergy(v: number): "lower" | "same" | "higher" {
  return ENERGY_SNAP.find((s) => v < s.max)?.value ?? "same";
}

export function snapTempo(v: number): "dragging" | "locked" | "rushing" {
  return TEMPO_SNAP.find((s) => v < s.max)?.value ?? "locked";
}

export const ENERGY_VALUE_TO_LABEL: Record<"lower" | "same" | "higher", string> = {
  lower: "LOWER",
  same: "SAME",
  higher: "HIGHER",
};

export const TEMPO_VALUE_TO_LABEL: Record<"dragging" | "locked" | "rushing", string> = {
  dragging: "DRAGGING",
  locked: "LOCKED",
  rushing: "RUSHING",
};

export const ENERGY_LABEL_TO_VALUE: Record<string, number> = {
  lower: 2,
  same: 5,
  higher: 8,
};

export const TEMPO_LABEL_TO_VALUE: Record<string, number> = {
  dragging: 2,
  locked: 5,
  rushing: 8,
};

export function energyToNumber(s: string | null | undefined): number {
  return ENERGY_LABEL_TO_VALUE[s ?? "same"] ?? 5;
}

export function tempoToNumber(s: string | null | undefined): number {
  return TEMPO_LABEL_TO_VALUE[s ?? "locked"] ?? 5;
}
