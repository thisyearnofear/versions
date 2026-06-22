// MODULAR: cover generator tests. Pure helpers re-implemented for tests
// (mirror the browser-side implementation in src/lib/cover.ts or web/lib/cover.js).

import { describe, it, expect } from 'vitest';

function computePeaks(channelData: Float32Array, n: number): number[] {
  const peaks = new Array(n).fill(0);
  const blockSize = Math.max(1, Math.floor(channelData.length / n));
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  let peak = 0;
  for (const p of peaks) if (p > peak) peak = p;
  if (peak > 0) for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / peak;
  return peaks;
}

function peaksToSvg(peaks: number[], options: { size?: number; color?: string; bg?: string } = {}): string {
  const opts = options;
  const size = opts.size || 200;
  const color = opts.color || 'var(--rust, #c84a1f)';
  const bg = opts.bg || 'var(--paper, #f4efe5)';
  const mid = size / 2;
  const inset = size * 0.04;
  const drawW = size - inset * 2;
  const upper: string[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = inset + (i / Math.max(1, peaks.length - 1)) * drawW;
    const h = peaks[i] * (mid - inset);
    upper.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${(mid - h).toFixed(1)}`);
  }
  const lower: string[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = inset + (i / Math.max(1, peaks.length - 1)) * drawW;
    const h = peaks[i] * (mid - inset);
    lower.push(`${x.toFixed(1)},${(mid + h).toFixed(1)}`);
  }
  const path = upper.concat(lower.slice().reverse()).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Waveform"><rect width="${size}" height="${size}" fill="${bg}"/><line x1="0" y1="${mid}" x2="${size}" y2="${mid}" stroke="${color}" stroke-opacity="0.15" stroke-width="0.5"/><path d="${path} Z" fill="${color}" fill-opacity="0.30" stroke="${color}" stroke-width="1"/></svg>`;
}

describe('computePeaks', () => {
  it('returns n peaks in [0, 1]', () => {
    const data = new Float32Array(640);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 10);
    const peaks = computePeaks(data, 64);
    expect(peaks.length).toBe(64);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('silent audio yields all zeros', () => {
    const data = new Float32Array(640);
    const peaks = computePeaks(data, 32);
    for (const p of peaks) expect(p).toBe(0);
  });

  it('short input still returns n peaks', () => {
    const data = new Float32Array(10);
    const peaks = computePeaks(data, 32);
    expect(peaks.length).toBe(32);
  });
});

describe('peaksToSvg', () => {
  it('returns a valid <svg> string', () => {
    const peaks = Array(32).fill(0).map((_, i) => i / 32);
    const svg = peaksToSvg(peaks);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.includes('<path')).toBe(true);
  });

  it('respects custom size + colours', () => {
    const peaks = [0.5, 0.5, 0.5, 0.5];
    const svg = peaksToSvg(peaks, { size: 100, color: '#ff0000', bg: '#000000' });
    expect(svg.includes('viewBox="0 0 100 100"')).toBe(true);
    expect(svg.includes('fill="#000000"')).toBe(true);
    expect(svg.includes('#ff0000')).toBe(true);
  });
});
