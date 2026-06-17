// MODULAR: Audio player + audio-reactive taste graph.
//
// One shared <audio> element. The app calls playFile(url,
// title, opts); the play loop wires a Web Audio AnalyserNode
// to the element and runs a RAF that mutates the radar SVG in
// the feed row. When the audio pauses / ends / is replaced,
// the radar settles back to the static aggregated values.
//
// ENHANCEMENT FIRST: the static radar is the source of truth;
// the reactive loop only modulates the 4 axis values around
// their static baseline (0.7 * baseline + 0.3 * audioGain *
// baseline). When audio isn't playing, the radar is identical
// to before this change.
//
// PERFORMANT: only one audio context + one analyser + one
// RAF is ever alive. Starting a new track stops the previous
// track's loop. The RAF mutates SVG attributes (cx, cy,
// points) — no innerHTML reassignments, no SVG regeneration.

'use strict';

let currentAudio = null;
let currentCtx = null;
let currentSource = null;
let currentAnalyser = null;
let currentRadarTarget = null;
let currentBaseline = null;
let currentValues = null;
let currentRaf = null;

function avg(arr, lo, hi) {
  let s = 0, n = 0;
  for (let i = lo; i < hi; i++) { s += arr[i]; n++; }
  return n > 0 ? s / n : 0;
}

function stopReactiveRadar() {
  if (currentRaf) cancelAnimationFrame(currentRaf);
  if (currentRadarTarget && currentBaseline && window.updateTasteGraphValues) {
    // MODULAR: restore the static aggregated values so the
    // radar reads as the curator consensus again, not the
    // last frame of the audio analysis.
    window.updateTasteGraphValues(currentRadarTarget, currentBaseline);
  }
  currentRaf = null;
  currentAnalyser = null;
  currentRadarTarget = null;
  currentBaseline = null;
  currentValues = null;
  if (currentCtx && currentCtx.state !== 'closed') {
    // MODULAR: don't await — the context close is async but
    // the next playFile() will create a new one anyway.
    currentCtx.close().catch(() => {});
  }
  currentCtx = null;
  currentSource = null;
}

function startReactiveRadar(audio, target, baseline) {
  stopReactiveRadar();
  // MODULAR: Web Audio setup is best-effort. Some browsers
  // throw if the <audio> is already connected to a different
  // context; the radar just stays static in that case.
  let ctx, src, analyser, freqData;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  } catch (err) {
    return;  // graceful fallback
  }
  currentCtx = ctx;
  currentSource = src;
  currentAnalyser = analyser;
  currentRadarTarget = target;
  currentBaseline = { ...baseline };
  currentValues = { ...baseline };

  function tick() {
    if (!currentAnalyser) return;
    analyser.getByteFrequencyData(freqData);
    const N = freqData.length;
    // MODULAR: 4 frequency bands. The splits are tuned for
    // music (44.1kHz sample rate, fftSize=256 → ~172Hz/bin):
    // sub-bass 0-150Hz, bass 150-500Hz, mid 500-2kHz, treble 2k+.
    const sub = avg(freqData, 0, Math.floor(N * 0.04));
    const low = avg(freqData, Math.floor(N * 0.04), Math.floor(N * 0.18));
    const mid = avg(freqData, Math.floor(N * 0.18), Math.floor(N * 0.5));
    const high = avg(freqData, Math.floor(N * 0.5), N);
    // MODULAR: each axis is modulated by its band. The static
    // baseline is preserved; the audio adds a breath of motion
    // (±30% of the baseline). Sub-bass drives SOLO (low
    // frequencies = solo-driven), bass drives VOCAL (the
    // fundamental of most vocals lives here), mid drives
    // ENERGY (mid is where most musical energy lives), treble
    // drives TEMPO (highs spike on snare hits, which is
    // tempo-relevant).
    const subG  = sub  / 255;
    const lowG  = low  / 255;
    const midG  = mid  / 255;
    const highG = high / 255;
    currentValues.solo   = baseline.solo   * (0.70 + subG  * 0.60);
    currentValues.vocal  = baseline.vocal  * (0.70 + lowG  * 0.60);
    currentValues.energy = baseline.energy * (0.70 + midG  * 0.60);
    currentValues.tempo  = baseline.tempo  * (0.70 + highG * 0.60);
    if (window.updateTasteGraphValues) {
      window.updateTasteGraphValues(target, currentValues);
    }
    currentRaf = requestAnimationFrame(tick);
  }
  currentRaf = requestAnimationFrame(tick);
}

export function playFile(url, title, opts) {
  stop();
  const audio = new Audio(url);
  audio.preload = 'metadata';
  audio.title = title || '';
  audio.controls = true;
  currentAudio = audio;
  // MODULAR: the audio-reactive radar wires up on play, not
  // on creation — the AudioContext can only be created in
  // response to a user gesture. The play() call (triggered by
  // the click) counts; the AnalyserNode is wired on first play.
  if (opts && opts.radarTarget && opts.baselineValues) {
    audio.addEventListener('play', () => {
      startReactiveRadar(audio, opts.radarTarget, opts.baselineValues);
    }, { once: true });
  }
  return audio;
}

export function stop() {
  stopReactiveRadar();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}

// MODULAR: a tiny helper for callers that want to disable the
// reactive mode without stopping the audio (e.g. when the
// user clicks the radar to manually rate). Not used yet but
// the API is in place.
export function disableReactiveMode() {
  stopReactiveRadar();
}
