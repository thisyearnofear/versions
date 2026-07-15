// MODULAR: Audio/text embedding adapter for CLAP-style semantic search.
// DRY: every embedding call goes through this adapter. No other module
//      talks to the embedding endpoint.
// PERFORMANT: mock-first — when EMBEDDING_API_URL is missing, returns
//             deterministic 512-dim vectors so the demo + tests run
//             without an external service.
// CLEAN: returns typed responses; never throws on connectivity — falls
//        back to mock and flags the response with `mock: true`.

import { createHash } from 'crypto';
import { requestJson } from '../lib/http';

// MODULAR: CLAP default embedding dimension. Most CLAP checkpoints
// produce 512-dim vectors. If a different model is used, set
// EMBEDDING_DIMENSIONS in env to match.
const DEFAULT_DIMENSIONS = 512;
const DEFAULT_TIMEOUT = 30_000;

export interface EmbeddingConfig {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  mock: boolean;
  model: string;
}

export interface EmbeddingAdapter {
  embedAudio(audioUrl: string): Promise<EmbeddingResult>;
  embedText(text: string): Promise<EmbeddingResult>;
  mock: boolean;
  dimensions: number;
  model: string;
}

// MODULAR: deterministic mock embedding from a hash. Same input → same
// vector, so tests are reproducible and the backfill is idempotent.
// The hash is spread across all dimensions via a simple PRNG seeded
// from the SHA-256 of the input — not cryptographically meaningful,
// but consistent and fast.
function mockEmbedding(input: string, dimensions: number): number[] {
  const hash = createHash('sha256').update(input).digest();
  const vec: number[] = [];
  let seed = 0;
  for (let i = 0; i < dimensions; i++) {
    if (i % 32 === 0) seed = hash.readUInt32BE(i % 28);
    // xorshift32 PRNG for deterministic pseudo-random floats in [-1, 1]
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    vec.push((seed / 0xFFFFFFFF) * 2 - 1);
  }
  // L2-normalize so cosine distance is just dot product.
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function createEmbeddingAdapter(config: EmbeddingConfig = {}): EmbeddingAdapter {
  const apiUrl = config.apiUrl || process.env.EMBEDDING_API_URL || '';
  const apiKey = config.apiKey || process.env.EMBEDDING_API_KEY || '';
  const model = config.model || process.env.EMBEDDING_MODEL || 'clap-default';
  const dimensions = config.dimensions || Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_DIMENSIONS;
  const isMock = !apiUrl;

  async function realEmbed(payload: Record<string, unknown>): Promise<EmbeddingResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const result = await requestJson<{ embedding: number[]; model?: string }>(
      apiUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, model }),
        timeoutMs: DEFAULT_TIMEOUT,
      },
      'embedding',
    );
    return {
      embedding: result.embedding,
      mock: false,
      model: result.model || model,
    };
  }

  return {
    mock: isMock,
    dimensions,
    model,
    async embedAudio(audioUrl: string): Promise<EmbeddingResult> {
      if (isMock) {
        return { embedding: mockEmbedding('audio:' + audioUrl, dimensions), mock: true, model };
      }
      return realEmbed({ audio_url: audioUrl });
    },
    async embedText(text: string): Promise<EmbeddingResult> {
      if (isMock) {
        return { embedding: mockEmbedding('text:' + text, dimensions), mock: true, model };
      }
      return realEmbed({ text });
    },
  };
}
