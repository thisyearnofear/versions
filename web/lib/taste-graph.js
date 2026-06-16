// MODULAR: Taste-graph radar. A single SVG with 5 axes (solo, vocal,
// energy, tempo, mood) closing into a polygon. Used in the feed
// (right-aligned mini) and the rate scorecard (large interactive).
//
// Pure SVG, no library. ~120 lines.

'use strict';

const AXES = [
  { id: 'solo',   label: 'Solo',   angle: -Math.PI / 2 },                 // top
  { id: 'vocal',  label: 'Vocal',  angle: -Math.PI / 2 + (2 * Math.PI) / 5 },
  { id: 'energy', label: 'Energy', angle: -Math.PI / 2 + (4 * Math.PI) / 5 },
  { id: 'tempo',  label: 'Tempo',  angle: -Math.PI / 2 + (6 * Math.PI) / 5 },
  { id: 'mood',   label: 'Mood',   angle: -Math.PI / 2 + (8 * Math.PI) / 5 }
];

// MODULAR: a small, label-less mini radar for the feed. The feed uses
// this; the rate scorecard will use the larger interactive version
// (next drop).
export function renderTasteGraph(target, values) {
  const size = target.clientWidth || 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 14;
  const rings = [0.25, 0.5, 0.75, 1];

  const valueAt = (axis) => {
    const v = Number(values && values[axis.id]) || 0;
    return Math.max(0, Math.min(10, v)) / 10;
  };

  const point = (axis, scale) => {
    const dist = r * scale;
    return [cx + Math.cos(axis.angle) * dist, cy + Math.sin(axis.angle) * dist];
  };

  const parts = [];

  // Background rings.
  for (const s of rings) {
    const pts = AXES.map((a) => point(a, s).map((n) => n.toFixed(1)).join(','));
    parts.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(26,26,26,0.10)" stroke-width="0.5"/>`);
  }

  // Axes.
  for (const a of AXES) {
    const [x, y] = point(a, 1);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(26,26,26,0.18)" stroke-width="0.5"/>`);
  }

  // Value polygon.
  const valuePts = AXES.map((a) => point(a, valueAt(a)).map((n) => n.toFixed(1)).join(','));
  parts.push(`<polygon points="${valuePts}" fill="rgba(200,74,31,0.18)" stroke="var(--rust, #c84a1f)" stroke-width="1.5" stroke-linejoin="round"/>`);

  // Value dots.
  for (const a of AXES) {
    const [x, y] = point(a, valueAt(a));
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="var(--rust, #c84a1f)"/>`);
  }

  // Axis labels.
  for (const a of AXES) {
    const [x, y] = point(a, 1.18);
    parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono, monospace" font-size="8" letter-spacing="0.1em" fill="rgba(26,26,26,0.7)">${a.label.toUpperCase()}</text>`);
  }

  target.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Taste graph">${parts.join('')}</svg>`;
}

// MODULAR: expose renderTasteGraph on window for app.js to use. The
// interactive version (used in the rate scorecard) is built on top of
// this; for Drop 1 we only ship the read-only mini.
window.renderTasteGraph = renderTasteGraph;
