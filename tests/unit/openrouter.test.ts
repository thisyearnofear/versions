import { describe, it, expect, afterEach } from 'vitest';
import {
  fitEmbeddingDimensions,
  resolveEmbeddingConfig,
  resolveLlmConfig,
  OPENROUTER_DEFAULT_EMBED_MODEL,
  OPENROUTER_DEFAULT_LLM_MODEL,
} from '@/lib/openrouter';
import { buildCatalogEmbedText } from '@/lib/catalog-embed-text';

describe('openrouter config', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns mock when no keys are set', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.EMBEDDING_API_URL;
    expect(resolveLlmConfig().provider).toBe('mock');
    expect(resolveEmbeddingConfig().provider).toBe('mock');
  });

  it('enables OpenRouter LLM + embeddings from OPENROUTER_API_KEY', () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    delete process.env.LLM_API_KEY;
    delete process.env.EMBEDDING_API_URL;
    const llm = resolveLlmConfig();
    const emb = resolveEmbeddingConfig();
    expect(llm.provider).toBe('openrouter');
    expect(llm.model).toBe(OPENROUTER_DEFAULT_LLM_MODEL);
    expect(emb.provider).toBe('openrouter');
    expect(emb.model).toBe(OPENROUTER_DEFAULT_EMBED_MODEL);
    expect(emb.audioCapable).toBe(false);
  });

  it('prefers explicit LLM_API_KEY over OpenRouter', () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.LLM_API_KEY = 'sk-custom';
    process.env.LLM_API_URL = 'https://api.example.com/v1';
    const llm = resolveLlmConfig();
    expect(llm.provider).toBe('custom');
    expect(llm.apiUrl).toBe('https://api.example.com/v1');
  });

  it('prefers EMBEDDING_API_URL over OpenRouter for embeddings', () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.EMBEDDING_API_URL = 'https://clap.example.com/embed';
    const emb = resolveEmbeddingConfig();
    expect(emb.provider).toBe('custom');
    expect(emb.audioCapable).toBe(true);
  });
});

describe('fitEmbeddingDimensions', () => {
  it('truncates and re-normalizes long vectors', () => {
    const vec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const out = fitEmbeddingDimensions(vec, 512);
    expect(out).toHaveLength(512);
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('pads short vectors', () => {
    const out = fitEmbeddingDimensions([1, 0, 0], 5);
    expect(out).toHaveLength(5);
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe('buildCatalogEmbedText', () => {
  it('joins track metadata and placement brief fields', () => {
    const text = buildCatalogEmbedText(
      {
        title: 'Neon Drift',
        artistName: 'Kai',
        versionType: 'live',
        genre: 'electronic',
        aggregatedMoodTags: '["cinematic","tense"]',
      },
      {
        sceneTags: ['car chase'],
        instruments: ['synth_led'],
        emotionalArcs: ['build to release'],
        audienceSummary: 'Sync-forward alternate take.',
      },
    );
    expect(text).toContain('Neon Drift');
    expect(text).toContain('car chase');
    expect(text).toContain('cinematic');
  });
});
