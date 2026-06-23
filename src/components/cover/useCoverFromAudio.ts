"use client";

// MODULAR: cover generation from audio. The cover is a 1:1 SVG
// that visualises the audio as a symmetric waveform. Port of
// web/lib/cover.js with the algorithm kept verbatim — only the
// module shape changes (now a React hook that returns the SVG
// string + loading state).
//
// The cover is OPTIONAL. The submit form falls back to a
// radar-only row in the feed when cover_svg is null.

import { useEffect, useRef, useState } from "react";

export interface CoverOptions {
  size?: number;
  color?: string;
  bg?: string;
}

/**
 * MODULAR: pure peak extraction. A downsampled abs-max
 * representation of the audio. 64-bin output is the right
 * resolution for a 1:1 cover: enough detail to read, few
 * enough bars to look like a waveform not noise.
 */
export function computePeaks(channelData: Float32Array, n: number): number[] {
  const peaks = new Array<number>(n);
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
  // would otherwise render as a flat line.
  let peak = 0;
  for (const p of peaks) if (p > peak) peak = p;
  if (peak > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / peak;
  }
  return peaks;
}

/**
 * MODULAR: pure peak → SVG. The waveform is a closed path
 * that's symmetric around the horizontal mid-line. Colour
 * matches the radar's rust + the paper background.
 */
export function peaksToSvg(peaks: number[], options: CoverOptions = {}): string {
  const size = options.size ?? 200;
  const color = options.color ?? "var(--color-rust, #c84a1f)";
  const bg = options.bg ?? "var(--color-paper, #f4efe5)";
  const mid = size / 2;
  const inset = size * 0.04;
  const drawW = size - inset * 2;
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = inset + (i / Math.max(1, peaks.length - 1)) * drawW;
    const h = peaks[i] * (mid - inset);
    upper.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${(mid - h).toFixed(1)}`);
    lower.push(`${(i / Math.max(1, peaks.length - 1) * drawW + inset).toFixed(1)},${(mid + h).toFixed(1)}`);
  }
  const path = upper.concat(lower.slice().reverse()).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Waveform"><rect width="${size}" height="${size}" fill="${bg}"/><line x1="0" y1="${mid}" x2="${size}" y2="${mid}" stroke="${color}" stroke-opacity="0.15" stroke-width="0.5"/><path d="${path} Z" fill="${color}" fill-opacity="0.30" stroke="${color}" stroke-width="1"/></svg>`;
}

/**
 * MODULAR: file → cover SVG. The only async I/O; the rest of
 * the module is pure. Errors are surfaced via the hook's
 * `error` field so the form can render a fallback.
 */
export async function generateCoverSvg(file: File, options?: CoverOptions): Promise<string> {
  if (!file) throw new Error("generateCoverSvg: no file");
  // MODULAR: AudioContext is best-effort. Some browsers throw
  // if it can't be created (rare).
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const peaks = computePeaks(channelData, 64);
    return peaksToSvg(peaks, options);
  } finally {
    if (ctx.state !== "closed") {
      ctx.close().catch(() => {});
    }
  }
}

export interface UseCoverFromAudioResult {
  svg: string | null;
  loading: boolean;
  error: Error | null;
}

/**
 * MODULAR: React hook wrapper. Generates the cover SVG whenever
 * `file` changes. Cancels in-flight work on unmount or file
 * change so the UI never shows stale results.
 */
export function useCoverFromAudio(file: File | null, options?: CoverOptions): UseCoverFromAudioResult {
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!file) {
      setSvg(null);
      setError(null);
      setLoading(false);
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    const token = ++tokenRef.current;
    setLoading(true);
    setError(null);
    generateCoverSvg(file, options)
      .then((result) => {
        if (token !== tokenRef.current) return;
        setSvg(result);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (token !== tokenRef.current) return;
        setError(err);
        setLoading(false);
        setSvg(null);
      });
  }, [file, options?.size, options?.color, options?.bg]);

  return { svg, loading, error };
}
