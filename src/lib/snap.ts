// MODULAR: discrete-value snap helpers for the energy + tempo + valence
// axes. The radar is continuous (0-10) but the server validates against
// the discrete labels: lower / same / higher + dragging / locked / rushing
// + bright / neutral / dark. The bands are centred on 2/5/8 with a
// half-width of ~1.7, matching the L/S/H + D/L/R + B/N/D dots on the
// radar.

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
const VALENCE_SNAP = [
  { max: 3.4, value: "dark" as const },
  { max: 6.7, value: "neutral" as const },
  { max: 11, value: "bright" as const },
];

export function snapEnergy(v: number): "lower" | "same" | "higher" {
  return ENERGY_SNAP.find((s) => v < s.max)?.value ?? "same";
}

export function snapTempo(v: number): "dragging" | "locked" | "rushing" {
  return TEMPO_SNAP.find((s) => v < s.max)?.value ?? "locked";
}

export function snapValence(v: number): "bright" | "neutral" | "dark" {
  return VALENCE_SNAP.find((s) => v < s.max)?.value ?? "neutral";
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

export const VALENCE_LABEL_TO_VALUE: Record<string, number> = {
  bright: 8,
  neutral: 5,
  dark: 2,
};

export function energyToNumber(s: string | null | undefined): number {
  return ENERGY_LABEL_TO_VALUE[s ?? "same"] ?? 5;
}

export function tempoToNumber(s: string | null | undefined): number {
  return TEMPO_LABEL_TO_VALUE[s ?? "locked"] ?? 5;
}

export function valenceToNumber(s: string | null | undefined): number {
  // MODULAR: unknown / null keys fall through to 5 (neutral). Same defensive
  // shape as energyToNumber / tempoToNumber so callers can pass either the
  // raw DB string (which can be null until ratings land) or an arbitrary
  // input without crashing the radar.
  return VALENCE_LABEL_TO_VALUE[s ?? "neutral"] ?? 5;
}
