// MODULAR: Audio feature extraction for agent scoring.
// Extracts tempo, key, energy, danceability, acousticness, loudness,
// instrumentalness, and valence from audio files using an external
// feature extraction API (default: OpenL3 / CLAP via EMBEDDING_API_URL).
//
// This is the gating capability for the authorized-version pilot:
// "ranked by sync fit" only becomes defensible when agents evaluate
// actual audio characteristics, not just creator-supplied metadata.
//
// Architecture:
// - extractAudioFeatures(audioPath: string): Promise<AudioFeatures>
//   Reads raw audio, sends to extraction endpoint, returns structured features.
// - Features are stored on submissions.audio_features (jsonb)
// - Agent prompts include features alongside metadata (see agents.ts)

import type { AudioFeatures } from './types';

export { type AudioFeatures };

/**
 * Extract audio features from an audio file.
 *
 * In production, this calls the extraction endpoint configured via
 * EMBEDDING_API_URL (which points to a CLAP/ONNX model endpoint that
 * returns features). For the pilot, we can use a lightweight local
 * extraction (ffmpeg-based) if the remote endpoint isn't available.
 */
export async function extractAudioFeatures(
  audioPath: string,
  apiKey?: string,
  apiUrl?: string,
): Promise<AudioFeatures> {
  // Strategy: try the configured endpoint first, fall back to manual
  // scoring if unavailable. This keeps the system running during the
  // pilot while we wait for the extraction endpoint.
  if (apiKey && apiUrl) {
    try {
      return await extractViaApi(audioPath, apiKey, apiUrl);
    } catch {
      // Fall through to manual scoring
    }
  }
  return extractManually(audioPath);
}

/**
 * Send audio to the extraction endpoint.
 * The endpoint should accept audio file bytes and return structured features.
 * Expected response shape matches AudioFeatures.
 */
async function extractViaApi(
  audioPath: string,
  apiKey: string,
  apiUrl: string,
): Promise<AudioFeatures> {
  const fs = await import('fs');
  const path = await import('path');
  const { Readable } = await import('stream');
  const { pipeline } = await import('stream/promises');

  const ext = path.extname(audioPath);
  const buffer = fs.readFileSync(audioPath);
  const readable = Readable.from(buffer);

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

  // Normalize endpoint response to our AudioFeatures shape.
  // Different endpoints may return different field names — this adapter
  // maps common conventions.
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

/**
 * Manual feature extraction when no extraction endpoint is configured.
 * Extracts basic features from audio using system tools (ffmpeg).
 * This provides a minimum viable feature set for agent scoring during
 * the pilot — more detailed features require a trained model.
 */
async function extractManually(audioPath: string): Promise<AudioFeatures> {
  const { execSync } = await import('child_process');

  // Use ffmpeg to extract basic audio properties
  const probe = JSON.parse(
    execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${audioPath}"`).toString(),
  );

  // Duration in seconds
  const duration = parseFloat(probe.format?.duration ?? '0');

  // Sample rate and channel info
  const sampleRate = parseInt(probe.format?.sample_rate ?? '44100', 10);
  const channels = parseInt(probe.format?.channels ?? '2', 10);

  // Basic analysis
  return {
    tempo: null, // Requires beat detection (not available via ffprobe alone)
    key: null,   // Requires key detection (Chromagram + pitch class)
    energy: null, // Requires RMS/crest factor calculation
    danceability: null,
    acousticness: null,
    loudness: null, // ffprobe provides audio_level but not normalized dB
    instrumentalness: null,
    valence: null,
    // Provide the raw data we CAN extract for potential future processing
    _raw: {
      duration,
      sampleRate,
      channels,
      bitrate: probe.format?.bit_rate,
      codec: probe.streams?.[0]?.codec_name,
    },
  };
}

/**
 * Format audio features for inclusion in an agent prompt.
 * Converts structured feature values to human-readable descriptions
 * that the LLM can use for scoring.
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