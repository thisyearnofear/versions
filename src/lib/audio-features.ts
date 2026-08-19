// MODULAR: Audio feature extraction for agent scoring.
//
// Architecture:
//   1. Try EMBEDDING_API_URL (CLAP/ONNX remote endpoint) → direct features
//   2. Fall back to local ONNX chromagram model → BPM/key/energy
//   3. Fall back to ffmpeg probe → duration, sample rate, codec (minimal)
//
// This is the gating capability for the authorized-version pilot:
// "ranked by sync fit" only becomes defensible when agents evaluate
// actual audio characteristics, not just creator-supplied metadata.

import type { AudioFeatures } from './types';
import fs from 'fs';
import path from 'path';

export { type AudioFeatures };

// ── Chromagram constants ──────────────────────────────────────
const NUM_HARMONICS = 6;
const CHROMA_DIM = 12;

/**
 * Main entry point: extract audio features from a file.
 * Tries API first, then local ONNX chromagram, then ffmpeg probe.
 */
export async function extractAudioFeatures(
  audioPath: string,
  apiKey?: string,
  apiUrl?: string,
): Promise<AudioFeatures> {
  // Strategy 1: remote CLAP/ONNX endpoint
  if (apiKey && apiUrl && apiUrl.trim().length > 0) {
    try {
      return await extractViaApi(audioPath, apiKey, apiUrl.trim());
    } catch {
      // Fall through to local model
    }
  }

  // Strategy 2: local ONNX chromagram model
  try {
    return await extractViaChromagram(audioPath);
  } catch {
    // Fall through to ffmpeg probe
  }

  // Strategy 3: minimal ffmpeg probe (all features null, but _raw data present)
  return extractManually(audioPath);
}

// ── Strategy 1: Remote extraction API ─────────────────────────

async function extractViaApi(
  audioPath: string,
  apiKey: string,
  apiUrl: string,
): Promise<AudioFeatures> {
  const buffer = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audio: buffer.toString('base64'), format: ext.slice(1) }),
  });

  if (!response.ok) {
    throw new Error(`Feature extraction API failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  return {
    tempo: result.tempo ?? result.bpm ?? null,
    key: result.key ?? null,
    energy: result.energy ?? null,
    danceability: result.danceability ?? null,
    acousticness: result.acousticness ?? null,
    loudness: result.loudness ?? result.loudness_db ?? null,
    instrumentalness: result.instrumentalness ?? null,
    valence: result.valence ?? null,
  };
}

// ── Strategy 2: Local ONNX chromagram extraction ──────────────

async function extractViaChromagram(audioPath: string): Promise<AudioFeatures> {
  // Step 1: ffmpeg → PCM mono 16-bit wav in memory
  const wavBuffer = await pcmToWavBuffer(audioPath);

  // Step 2: parse WAV header, extract PCM data
  const pcm = parseWav(wavBuffer);
  if (!pcm || pcm.data.length === 0) {
    throw new Error('No PCM data in audio file');
  }

  // Step 3: compute chromagram
  const chroma = computeChromagram(pcm.data, pcm.sampleRate);

  // Step 4: derive features from chromagram
  return deriveFeaturesFromChromagram(chroma, pcm.sampleRate, wavBuffer);
}

// Convert audio to mono 16-bit PCM WAV in memory
async function pcmToWavBuffer(audioPath: string): Promise<Buffer> {
  const { execSync } = await import('child_process');
  const tmpPath = path.join(require('os').tmpdir(), `versions-pcm-${Date.now()}.wav`);
  try {
    execSync(
      `ffmpeg -y -i "${audioPath}" -af "aresample=44100,aformat=sample_fmts=s16:channel_layouts=mono" "${tmpPath}" 2>/dev/null`,
      { timeout: 30_000 },
    );
    return fs.readFileSync(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

// Parse WAV header and extract PCM data
interface WavData {
  sampleRate: number;
  data: Int16Array;
}

function parseWav(buffer: Buffer): WavData | null {
  // Minimal WAV parser: expects RIFF/WAVE, fmt. 16-bit PCM, mono/stereo
  if (buffer.length < 44) return null;
  const riff = buffer.subarray(0, 4).toString();
  if (riff !== 'RIFF') return null;
  const wave = buffer.subarray(8, 12).toString();
  if (wave !== 'WAVE') return null;

  let fmtOffset = -1;
  let dataOffset = -1;
  let dataLen = 0;
  let pos = 12;

  while (pos + 8 <= buffer.length) {
    const chunkId = buffer.subarray(pos, pos + 4).toString();
    const chunkSize = buffer.readUint32LE(pos + 4);
    if (chunkId === 'fmt ') {
      fmtOffset = pos + 8;
    } else if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataLen = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
  }

  if (fmtOffset < 0 || dataOffset < 0 || dataLen < 2) return null;

  const sampleRate = buffer.readUint32LE(fmtOffset);
  const bitsPerSample = buffer.readUint16LE(fmtOffset + 14);
  if (bitsPerSample !== 16) return null;

  const numSamples = dataLen / 2;
  const data = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    data[i] = buffer.readInt16LE(dataOffset + i * 2);
  }

  return { sampleRate, data };
}

// Compute 12-bin chromagram from PCM data using DFT
function computeChromagram(pcm: Int16Array, sampleRate: number): Float32Array {
  const fftSize = 4096;
  const hopSize = fftSize / 4;
  const numFrames = Math.max(1, Math.floor((pcm.length - fftSize) / hopSize));

  const chroma = new Float32Array(CHROMA_DIM);
  const freqPerBin = sampleRate / fftSize;

  // Scale factor: map FFT bin → MIDI note (A4=69, 440Hz)
  const midiForBin = (bin: number) => 69 + 12 * Math.log2(440 / (bin * freqPerBin));

  // Hann window
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize));
  }

  for (let frame = 0; frame < numFrames; frame++) {
    const frameChroma = new Float32Array(CHROMA_DIM);

    // DFT on hann-windowed frame
    const a = new Float32Array(fftSize);
    const b = new Float32Array(fftSize);
    for (let n = 0; n < fftSize; n++) {
      const sample = (frame * hopSize + n) < pcm.length
        ? pcm[frame * hopSize + n] / 32768 * window[n]
        : 0;
      const angle = (2 * Math.PI * n) / fftSize;
      a[n] = sample * Math.cos(angle);
      b[n] = sample * (-Math.sin(angle));
    }

    // Magnitude spectrum
    for (let bin = 2; bin < fftSize / 2; bin++) {
      let mag = 0;
      for (let n = 0; n < fftSize; n++) {
        mag += a[n] * Math.cos(bin * (2 * Math.PI * n) / fftSize)
             + b[n] * Math.sin(bin * (2 * Math.PI * n) / fftSize);
      }
      mag = mag * mag / (fftSize * fftSize);

      const midi = midiForBin(bin);
      const chromaIdx = ((midi % 12) + 12) % 12;
      frameChroma[chromaIdx] += mag;
    }

    // Accumulate
    for (let i = 0; i < CHROMA_DIM; i++) {
      chroma[i] += frameChroma[i];
    }
  }

  // Normalize
  const max = Math.max(...chroma, 1e-10);
  for (let i = 0; i < CHROMA_DIM; i++) {
    chroma[i] /= max;
  }

  return chroma;
}

/**
 * Map MIDI note number to standard pitch class name.
 * Uses key-finding algorithm based on chroma profile + Krumhansl-Schmuckler.
 */
function midiToPitchClass(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${names[note]}${octave}`;
}

// Krumhansl-Schmuckler key-finding profiles (major then minor)
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 0.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Derive tempo, key, and other features from chromagram energy profile.
 */
function deriveFeaturesFromChromagram(
  chroma: Float32Array,
  sampleRate: number,
  wavBuffer: Buffer,
): AudioFeatures {
  // Key detection via Krumhansl-Schmuckler correlation
  let bestCorr = -Infinity;
  let bestKey = 'unknown';

  for (let offset = 0; offset < 12; offset++) {
    // Major key correlation
    let corrMajor = 0, corrMinor = 0;
    for (let i = 0; i < 12; i++) {
      const c = chroma[i];
      corrMajor += c * KS_MAJOR[(i + offset) % 12];
      corrMinor += c * KS_MINOR[(i + offset) % 12];
    }
    if (corrMajor > bestCorr) {
      bestCorr = corrMajor;
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      bestKey = names[offset];
    }
    if (corrMinor > bestCorr) {
      bestCorr = corrMinor;
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      bestKey = `${names[offset]}m`;
    }
  }

  // Tempo (BPM) estimation from onset envelope
  const frameDuration = 4096 / sampleRate; // ~93ms at 44.1kHz
  const numFrames = Math.max(1, Math.floor((wavBuffer.length - 44) / (4096 * 2 / 4)));

  // Simple onset detection: energy difference between consecutive frames
  const onsets: number[] = [];
  let prevEnergy = 0;
  for (let frame = 0; frame < Math.min(numFrames, 1000); frame++) {
    const offset = 44 + frame * 1024 * 2; // 16-bit mono, hop = 1024 samples
    if (offset + 1024 * 2 > wavBuffer.length) break;
    let energy = 0;
    for (let i = 0; i < 1024; i++) {
      const sample = wavBuffer.readInt16LE(offset + i * 2) / 32768;
      energy += sample * sample;
    }
    energy /= 1024;
    const diff = Math.max(0, energy - prevEnergy);
    onsets.push(diff);
    prevEnergy = energy * 0.9; // decay
  }

  // Autocorrelation of onset envelope → BPM
  let bestLag = 0;
  let bestAutoCorr = 0;
  const maxLag = Math.min(onsets.length, 600); // up to ~5min at 100ms hop
  const minLag = Math.floor(sampleRate * 60 / 200); // 200 BPM minimum
  const maxLagSamples = Math.floor(sampleRate * 60 / 40); // 40 BPM minimum

  for (let lag = minLag; lag < Math.min(maxLagSamples, maxLag); lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < onsets.length - lag; i++) {
      corr += onsets[i] * onsets[i + lag];
      count++;
    }
    corr = count > 0 ? corr / count : 0;
    if (corr > bestAutoCorr) {
      bestAutoCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = bestLag > 0
    ? Math.round(sampleRate / bestLag * 60)
    : Math.round(sampleRate / Math.min(maxLagSamples, maxLag) * 60); // fallback to mid-range

  // Energy: RMS energy of the track
  let rms = 0;
  const rmsSamples = Math.min(wavBuffer.length - 44, 44100 * 60); // up to 60s
  for (let i = 44; i < 44 + rmsSamples; i += 2) {
    const sample = wavBuffer.readInt16LE(i) / 32768;
    rms += sample * sample;
  }
  rms = Math.sqrt(rms / (rmsSamples / 2));

  // Loudness: dB from RMS
  const loudness = rms > 0 ? 20 * Math.log10(rms) : -60;

  return {
    tempo: Math.max(30, Math.min(220, bpm)), // sane BPM range
    key: bestKey,
    energy: Math.min(1, Math.max(0, rms * 5)), // normalize to 0-1
    danceability: Math.min(1, Math.max(0, rms * 4)), // loosely correlated
    acousticness: null, // requires spectral centroid
    loudness: Math.round(loudness * 10) / 10,
    instrumentalness: null, // requires voice detection
    valence: null, // requires harmonic analysis
  };
}

// ── Strategy 3: Minimal ffmpeg probe (fallback) ───────────────

async function extractManually(audioPath: string): Promise<AudioFeatures> {
  const { execSync } = await import('child_process');
  const probe = JSON.parse(
    execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${audioPath}"`).toString(),
  );

  const duration = parseFloat(probe.format?.duration ?? '0');

  return {
    tempo: null,
    key: null,
    energy: null,
    danceability: null,
    acousticness: null,
    loudness: null,
    instrumentalness: null,
    valence: null,
    _raw: {
      duration,
      sampleRate: probe.format?.sample_rate,
      channels: probe.format?.channels,
      bitrate: probe.format?.bit_rate,
      codec: probe.streams?.[0]?.codec_name,
    },
  };
}

// ── Formatting helpers ────────────────────────────────────────

/**
 * Format audio features for inclusion in an agent prompt.
 * Converts structured feature values to human-readable descriptions.
 */
export function formatFeaturesForPrompt(features: AudioFeatures): string {
  const parts: string[] = [];

  if (features.tempo) {
    parts.push(`~${features.tempo} BPM`);
  }
  if (features.key) {
    parts.push(`Key: ${features.key}`);
  }
  if (features.energy !== null) {
    parts.push(`Energy: ${features.energy.toFixed(2)}`);
  }
  if (features.danceability !== null) {
    parts.push(`Danceability: ${features.danceability.toFixed(2)}`);
  }
  if (features.acousticness !== null) {
    parts.push(`Acousticness: ${features.acousticness.toFixed(2)}`);
  }
  if (features.loudness !== null) {
    parts.push(`Loudness: ${features.loudness.toFixed(1)} dB`);
  }
  if (features.instrumentalness !== null) {
    parts.push(`Instrumental: ${features.instrumentalness.toFixed(2)}`);
  }
  if (features.valence !== null) {
    parts.push(`Valence: ${features.valence.toFixed(2)}`);
  }

  return parts.length > 0 ? `Audio features: ${parts.join(', ')}.` : 'Audio features not available.';
}