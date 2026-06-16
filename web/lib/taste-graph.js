// MODULAR: Taste-graph radar. Two consumers, one module:
//   1. renderTasteGraph        — read-only mini for the feed (≤120px)
//   2. renderInteractiveRadar  — large draggable polygon for the rate
//      scorecard (~320px). The same primitive drawn at two scales.
//
// Geometry: 4 axes at the cardinal directions (SOLO top, VOCAL right,
// ENERGY bottom, TEMPO left) so the polygon reads as a compass and
// each axis gets a 90° slice to itself. Energy + tempo are
// continuous on the radar (0–10) and snap to the nearest discrete
// value at submit time (see app.js).

'use strict';

const INTERACTIVE_AXES = [
  { id: 'solo',   label: 'SOLO',   angle: -Math.PI / 2,  // top
    discrete: null,                                       // continuous 0-10
    axisIndex: 0 },
  { id: 'vocal',  label: 'VOCAL',  angle: 0,             // right
    discrete: null,
    axisIndex: 1 },
  { id: 'energy', label: 'ENERGY', angle: Math.PI / 2,   // bottom
    discrete: [
      { value: 0,  label: 'L' },                          // L / S / H tags
      { value: 5,  label: 'S' },
      { value: 10, label: 'H' }
    ],
    axisIndex: 2 },
  { id: 'tempo',  label: 'TEMPO',  angle: Math.PI,       // left
    discrete: [
      { value: 0,  label: 'D' },                          // D / L / R tags
      { value: 5,  label: 'L' },
      { value: 10, label: 'R' }
    ],
    axisIndex: 3 }
];

const MINI_AXES = [
  { id: 'solo',   label: 'Solo',   angle: -Math.PI / 2 },
  { id: 'vocal',  label: 'Vocal',  angle: 0 },
  { id: 'energy', label: 'Energy', angle: Math.PI / 2 },
  { id: 'tempo',  label: 'Tempo',  angle: Math.PI }
];

// MODULAR: small, label-less mini radar for the feed.
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
  for (const s of rings) {
    const pts = MINI_AXES.map((a) => point(a, s).map((n) => n.toFixed(1)).join(','));
    parts.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(26,26,26,0.10)" stroke-width="0.5"/>`);
  }
  for (const a of MINI_AXES) {
    const [x, y] = point(a, 1);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(26,26,26,0.18)" stroke-width="0.5"/>`);
  }
  const valuePts = MINI_AXES.map((a) => point(a, valueAt(a)).map((n) => n.toFixed(1)).join(','));
  parts.push(`<polygon points="${valuePts}" fill="rgba(200,74,31,0.18)" stroke="var(--rust, #c84a1f)" stroke-width="1.5" stroke-linejoin="round"/>`);
  for (const a of MINI_AXES) {
    const [x, y] = point(a, valueAt(a));
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="var(--rust, #c84a1f)"/>`);
  }
  for (const a of MINI_AXES) {
    const [x, y] = point(a, 1.18);
    parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono, monospace" font-size="8" letter-spacing="0.1em" fill="rgba(26,26,26,0.7)">${a.label.toUpperCase()}</text>`);
  }

  target.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Taste graph">${parts.join('')}</svg>`;
}

// MODULAR: large interactive radar. The user drags a polygon vertex
// along its axis to rate that dimension. Energy + tempo are continuous
// here and snap at submit time.
//
// MODULAR: returns the radar's current values via a getter so the
// caller can read the rating at any time. The optional onChange fires
// after every drag for live readouts.
export function renderInteractiveRadar(target, initialValues, onChange) {
  const size = target.clientWidth || 320;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 32;
  const rings = [0.25, 0.5, 0.75, 1];
  // External callers read via the returned getter, or subscribe via onChange.
  const values = {
    solo:   clamp(initialValues && initialValues.solo,   0, 10, 5),
    vocal:  clamp(initialValues && initialValues.vocal,  0, 10, 5),
    energy: clamp(initialValues && initialValues.energy, 0, 10, 5),
    tempo:  clamp(initialValues && initialValues.tempo,  0, 10, 5)
  };

  const point = (axis, value) => {
    const scale = value / 10;
    return [cx + Math.cos(axis.angle) * r * scale, cy + Math.sin(axis.angle) * r * scale];
  };

  function render() {
    const parts = [];

    // Background rings (light)
    for (const s of rings) {
      const pts = INTERACTIVE_AXES.map((a) => point(a, s * 10).map((n) => n.toFixed(1)).join(','));
      parts.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(26,26,26,0.10)" stroke-width="0.5"/>`);
    }

    // Axes (medium)
    for (const a of INTERACTIVE_AXES) {
      const [x, y] = point(a, 10);
      parts.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(26,26,26,0.24)" stroke-width="0.6"/>`);
    }

    // Discrete tags for energy / tempo (the L/S/H + D/L/R letters)
    for (const a of INTERACTIVE_AXES) {
      if (!a.discrete) continue;
      for (const d of a.discrete) {
        const [x, y] = point(a, d.value);
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="rgba(26,26,26,0.5)"/>`);
        // Tag label, perpendicular to axis
        const tx = cx + Math.cos(a.angle) * (r + 14);
        const ty = cy + Math.sin(a.angle) * (r + 14);
        parts.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono, monospace" font-size="9" letter-spacing="0.1em" fill="rgba(26,26,26,0.6)">${d.label}</text>`);
      }
    }

    // Value polygon
    const valuePts = INTERACTIVE_AXES.map((a) => point(a, values[a.id]).map((n) => n.toFixed(1)).join(','));
    parts.push(`<polygon points="${valuePts}" fill="rgba(200,74,31,0.18)" stroke="var(--rust, #c84a1f)" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>`);

    // Axis labels at the outer edge. The text-anchor varies by axis
    // angle so labels at 0° and 180° don't get clipped on the SVG edge.
    for (const a of INTERACTIVE_AXES) {
      const cx_cos = Math.cos(a.angle);
      const sin_a = Math.sin(a.angle);
      const tx = cx + cx_cos * (r + 22);
      const ty = cy + sin_a * (r + 22);
      const anchor = Math.abs(cx_cos) < 0.3 ? 'middle' : (cx_cos > 0 ? 'start' : 'end');
      const dx = anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0;
      parts.push(`<text x="${(tx + dx).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.18em" font-weight="600" fill="rgba(26,26,26,0.85)">${a.label}</text>`);
    }

    // MODULAR: draggable handles. Each handle is a pair — a
    // transparent 36px hit-area (Apple HIG 44pt minimum, scaled
    // down) + a visible 8px dot. The hit-area is what receives
    // pointer events; the visible dot follows it. Both share the
    // data-handle attr so querySelectorAll('[data-handle]') finds
    // both, and the click target is the larger one.
    for (const a of INTERACTIVE_AXES) {
      const [x, y] = point(a, values[a.id]);
      parts.push(`<circle data-handle="${a.id}" data-hit="1" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="36" fill="transparent" style="cursor: grab;"/>`);
      parts.push(`<circle data-handle="${a.id}" data-dot="1" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="var(--paper, #f4efe5)" stroke="var(--rust, #c84a1f)" stroke-width="2" pointer-events="none"/>`);
    }

    target.innerHTML = `<svg viewBox="-32 -32 384 384" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Taste graph (drag the dots to rate)">${parts.join('')}</svg>`;
    attachHandlers();
  }

  // MODULAR: pointer events work for mouse + touch. The axis is a unit
  // vector from the center; the new value is the projection of the
  // pointer's offset onto the axis, clamped to [0, 10].
  const VIEWBOX_W = 384, VIEWBOX_H = 384, VIEWBOX_OX = -32, VIEWBOX_OY = -32;
  function attachHandlers() {
    const svg = target.querySelector('svg');
    if (!svg) return;
    for (const handle of svg.querySelectorAll('[data-handle]')) {
      const id = handle.getAttribute('data-handle');
      const axis = INTERACTIVE_AXES.find((a) => a.id === id);
      if (!axis) continue;

      const onPointerMove = (ev) => {
        const rect = svg.getBoundingClientRect();
        // MODULAR: convert client coords to viewBox coords. The SVG
        // width/height is `size` but the viewBox is 384x384 starting
        // at (-32, -32), so there's a 32-unit margin on each side.
        const vbX = ((ev.clientX - rect.left) / rect.width) * VIEWBOX_W + VIEWBOX_OX;
        const vbY = ((ev.clientY - rect.top)  / rect.height) * VIEWBOX_H + VIEWBOX_OY;
        const x = vbX - cx;
        const y = vbY - cy;
        const proj = x * Math.cos(axis.angle) + y * Math.sin(axis.angle);
        const value = clamp((proj / r) * 10, 0, 10);
        values[id] = value;
        updateHandle(axis);
        updatePolygon();
        if (onChange) onChange(getValues());
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      handle.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }
  }

  function updateHandle(axis) {
    const svg = target.querySelector('svg');
    if (!svg) return;
    const handle = svg.querySelector(`[data-handle="${axis.id}"]`);
    if (!handle) return;
    const [x, y] = point(axis, values[axis.id]);
    handle.setAttribute('cx', x.toFixed(1));
    handle.setAttribute('cy', y.toFixed(1));
  }

  function updatePolygon() {
    const svg = target.querySelector('svg');
    if (!svg) return;
    const polygon = svg.querySelector('polygon[fill*="rgba(200,74,31"]');
    if (!polygon) return;
    const pts = INTERACTIVE_AXES.map((a) => point(a, values[a.id]).map((n) => n.toFixed(1)).join(','));
    polygon.setAttribute('points', pts.join(' '));
  }

  function getValues() {
    return { ...values };
  }

  render();
  return { getValues };
}

function clamp(v, min, max, fallback) {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

// MODULAR: expose both renderers on window. The feed calls
// window.renderTasteGraph; the rate scorecard calls
// window.renderInteractiveRadar.
window.renderTasteGraph = renderTasteGraph;
window.renderInteractiveRadar = renderInteractiveRadar;
