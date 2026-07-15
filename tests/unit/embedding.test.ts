// MODULAR: embedding adapter tests. Mock mode only — real mode
// requires an external API endpoint. Validates determinism,
// dimensions, L2 normalization, and the mock-first fallback.

import { describe, it, expect } from 'vitest';
import { createEmbeddingAdapter } from '../../src/adapters/embedding';

describe('embedding: mock mode', () => {
  it('is mock when no apiUrl is provided', () => {
    const emb = createEmbeddingAdapter({});
    expect(emb.mock).toBe(true);
  });

  it('is not mock when apiUrl is provided', () => {
    const emb = createEmbeddingAdapter({ apiUrl: 'https://example.com/embed' });
    expect(emb.mock).toBe(false);
  });

  it('returns deterministic embeddings for the same audio input', async () => {
    const emb = createEmbeddingAdapter({});
    const a = await emb.embedAudio('audio/sub-1.mp3');
    const b = await emb.embedAudio('audio/sub-1.mp3');
    expect(a.embedding).toEqual(b.embedding);
    expect(a.mock).toBe(true);
  });

  it('returns deterministic embeddings for the same text input', async () => {
    const emb = createEmbeddingAdapter({});
    const a = await emb.embedText('car chase scene');
    const b = await emb.embedText('car chase scene');
    expect(a.embedding).toEqual(b.embedding);
  });

  it('produces different embeddings for different inputs', async () => {
    const emb = createEmbeddingAdapter({});
    const a = await emb.embedText('car chase');
    const b = await emb.embedText('quiet piano');
    expect(a.embedding).not.toEqual(b.embedding);
  });

  it('produces L2-normalized vectors (unit length)', async () => {
    const emb = createEmbeddingAdapter({});
    const result = await emb.embedText('test');
    const norm = Math.sqrt(result.embedding.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('default dimensions is 512', async () => {
    const emb = createEmbeddingAdapter({});
    const result = await emb.embedText('test');
    expect(result.embedding.length).toBe(512);
    expect(emb.dimensions).toBe(512);
  });

  it('respects custom dimensions', async () => {
    const emb = createEmbeddingAdapter({ dimensions: 128 });
    const result = await emb.embedText('test');
    expect(result.embedding.length).toBe(128);
  });

  it('audio and text embeddings differ for the same underlying string', async () => {
    const emb = createEmbeddingAdapter({});
    const audio = await emb.embedAudio('test');
    const text = await emb.embedText('test');
    expect(audio.embedding).not.toEqual(text.embedding);
  });

  it('carries the model name', async () => {
    const emb = createEmbeddingAdapter({ model: 'clap-v2' });
    const result = await emb.embedText('test');
    expect(result.model).toBe('clap-v2');
  });
});
