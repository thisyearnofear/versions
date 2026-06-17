// MODULAR: Move 3 — cover generation from audio. The cover
// is a 1:1 SVG that visualises the audio as a symmetric
// waveform. Two consumers, one module:
//   1. generateCoverSvg(file)  — the submit form calls this
//      on file selection; the SVG is stored as
//      submissions.cover_svg
//   2. The feed row renders the SVG inline as a <div
//      class="feed-cover"> with the SVG as innerHTML.
//
// ENHANCEMENT FIRST: the cover is OPTIONAL. The feed row
// falls back to the radar-only layout if cover_svg is
// null. The migration is additive (TEXT column, no
// constraint), so existing rows are unaffected.
//
// DRY: the peak extraction + SVG generation are pure
// functions; the file-decode is the only async I/O.
//
// PERFORMANT: decodeAudioData runs once per file. Peak
// extraction is O(n) on the audio length. The result is
// a 64-bar SVG (~3KB) — small enough to ship in the
// submission payload.

'use strict';

/**
 * MODULAR: pure peak extraction. A downsampled abs-max
 * representation of the audio. The 64-bin output is the
 * right resolution for a 1:1 cover: enough detail to
 * read, few enough bars to look like a waveform not noise.
 *
 * @param {Float32Array} channelData  one channel of audio
 * @param {number}       n           number of bins
 * @returns {number[]}               normalised peaks in [0, 1]
 */
export function computePeaks(channelData, n) {
  const peaks = new Array(n);
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
  // MODULAR: normalise to [0, 1]. The peak of a quiet take
  // would otherwise render as a flat line; the top-of-range
  // peak becomes 1.0.
  let peak = 0;
  for (const p of peaks) if (p > peak) peak = p;
  if (peak > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / peak;
  }
  return peaks;
}

/**
 * MODULAR: pure peak → SVG. The waveform is a closed path
 * that's symmetric around the horizontal mid-line. The
 * colour matches the radar's rust + the paper background.
 *
 * @param {number[]} peaks   normalised peaks in [0, 1]
 * @param {object}   options
 * @param {number}   options.size    SVG viewBox side (default 200)
 * @param {string}   options.color   stroke colour (default rust)
 * @param {string}   options.bg      background colour (default paper)
 * @returns {string}                 inline SVG string
 */
export function peaksToSvg(peaks, options) {
  const opts = options || {};
  const size = opts.size || 200;
  const color = opts.color || 'var(--rust, #c84a1f)';
  const bg = opts.bg || 'var(--paper, #f4efe5)';
  const mid = size / 2;
  // MODULAR: a small inset so the wave doesn't touch the
  // edges (avoids a visual 'cropped' feel at small sizes).
  const inset = size * 0.04;
  const drawW = size - inset * 2;
  // MODULAR: the upper edge is the top of the wave, the
  // lower edge is the mirror. Both are joined into one
  // closed path so the fill is the area *under* the wave.
  const upper = [];
  const lower = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = inset + (i / Math.max(1, peaks.length - 1)) * drawW;
    const h = peaks[i] * (mid - inset);
    upper.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${(mid - h).toFixed(1)}`);
    // MODULAR: lower[] is built in reverse so the closed
    // path traces the bottom edge from right to left.
    lower.push(`${(i / Math.max(1, peaks.length - 1) * drawW + inset).toFixed(1)},${(mid + h).toFixed(1)}`);
  }
  // MODULAR: the path is upper + reversed lower. We do the
  // reverse inline so the SVG has one continuous d="..."
  // attribute, which is the canonical waveform shape.
  const path = upper.concat(lower.slice().reverse()).join(' ');
  // MODULAR: the SVG is a single <path> on a <rect> background.
  // The fill is the rust colour at 30% opacity (like the
  // radar polygon), the stroke is full rust. The mid-line
  // is a 1px hairline at 30% opacity (subtle but visible).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Waveform"><rect width="${size}" height="${size}" fill="${bg}"/><line x1="0" y1="${mid}" x2="${size}" y2="${mid}" stroke="${color}" stroke-opacity="0.15" stroke-width="0.5"/><path d="${path} Z" fill="${color}" fill-opacity="0.30" stroke="${color}" stroke-width="1"/></svg>`;
}

/**
 * MODULAR: file → cover SVG. The only async I/O; the rest
 * of the module is pure. Returns a small (~3KB) SVG
 * string. Errors are caught and surfaced via the
 * callback so the form can show a fallback (e.g. just
 * submit without a cover).
 *
 * @param {File}   file
 * @param {object} options   forwarded to peaksToSvg
 * @returns {Promise<string>}  the SVG string
 */
export async function generateCoverSvg(file, options) {
  if (!file) throw new Error('generateCoverSvg: no file');
  // MODULAR: AudioContext is best-effort. Some browsers
  // throw if it can't be created (rare). The form handles
  // errors via the await.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    // MODULAR: use the first channel (mix-down is fine
    // for a visual cover — we're not doing analysis).
    const channelData = audioBuffer.getChannelData(0);
    const peaks = computePeaks(channelData, 64);
    return peaksToSvg(peaks, options);
  } finally {
    // MODULAR: AudioContext is created per call so we close
    // it here. Otherwise Chrome shows a "AudioContext was
    // not closed after 5 seconds" warning.
    if (ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  }
}
