import { describe, it, expect, afterEach } from 'vitest';
import {
  fitEmbeddingDimensions,
  resolveEmbeddingConfig,
  resolveEmbeddingChain,
  resolveLlmConfig,
  resolveLlmChain,
  OPENROUTER_DEFAULT_EMBED_MODEL,
  OPENROUTER_DEFAULT_LLM_MODEL,
  VENICE_DEFAULT_LLM_MODEL,
  HF_QWEN_DEFAULT_MODEL,
} from '@/lib/openrouter';
import { buildCatalogEmbedText } from '@/lib/catalog-embed-text';

// MODULAR: provider-chain tests. resolveLlmChain/resolveEmbeddingChain read a
// growing set of env keys, so each test starts from a hermetic state to keep
// priority assertions deterministic regardless of the dev shell environment.
describe('inference provider chain', () => {
  const env = { ...process.env };
  const INFERENCE_KEYS = [
    'OPENROUTER_API_KEY',
    'LLM_API_KEY',
    'LLM_API_URL',
    'LLM_MODEL',
    'VENICE_API_KEY',
    'VENICE_API_URL',
    'VENICE_MODEL',
    'VENICE_EMBED_ENABLE',
    'VENICE_EMBED_MODEL',
    'HF_QWEN_API_URL',
    'HF_QWEN_API_KEY',
    'HF_QWEN_MODEL',
    'EMBEDDING_API_URL',
    'EMBEDDING_API_KEY',
    'EMBEDDING_MODEL',
  ];

  function clearInference() {
    for (const k of INFERENCE_KEYS) delete process.env[k];
  }

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns empty LLM chain (→ mock) when no keys are set', () => {
    clearInference();
    expect(resolveLlmChain()).toHaveLength(0);
    expect(resolveLlmConfig().provider).toBe('mock');
    expect(resolveEmbeddingChain()).toHaveLength(0);
    expect(resolveEmbeddingConfig().provider).toBe('mock');
  });

  it('OpenRouter alone is both head and only entry', () => {
    clearInference();
    process.env.OPENROUTER_API_KEY = 'or-test';
    const chain = resolveLlmChain();
    expect(chain.map((c) => c.provider)).toEqual(['openrouter']);
    expect(resolveLlmConfig().provider).toBe('openrouter');
    expect(resolveLlmConfig().model).toBe(OPENROUTER_DEFAULT_LLM_MODEL);
    const emb = resolveEmbeddingConfig();
    expect(emb.provider).toBe('openrouter');
    expect(emb.model).toBe(OPENROUTER_DEFAULT_EMBED_MODEL);
    expect(emb.audioCapable).toBe(false);
  });

  it('Venice becomes primary when VENICE_API_KEY is set, OpenRouter is backup', () => {
    clearInference();
    process.env.VENICE_API_KEY = 'venice-test';
    process.env.OPENROUTER_API_KEY = 'or-test';
    const chain = resolveLlmChain();
    expect(chain.map((c) => c.provider)).toEqual(['venice', 'openrouter']);
    const head = resolveLlmConfig();
    expect(head.provider).toBe('venice');
    expect(head.model).toBe(VENICE_DEFAULT_LLM_MODEL);
    expect(head.apiKey).toBe('venice-test');
  });

  it('explicit LLM_API_KEY wins over Venice and everything else', () => {
    clearInference();
    process.env.LLM_API_KEY = 'sk-custom';
    process.env.LLM_API_URL = 'https://api.example.com/v1';
    process.env.VENICE_API_KEY = 'venice-test';
    process.env.OPENROUTER_API_KEY = 'or-test';
    const chain = resolveLlmChain();
    expect(chain[0].provider).toBe('custom');
    expect(chain[0].apiUrl).toBe('https://api.example.com/v1');
    expect(chain.map((c) => c.provider)).toEqual(['custom', 'venice', 'openrouter']);
  });

  it('HF Qwen joins only when HF_QWEN_API_URL is set, ordered last (free but unreliable)', () => {
    clearInference();
    process.env.VENICE_API_KEY = 'venice-test';
    process.env.HF_QWEN_API_URL = 'https://hf.example.com/v1';
    process.env.OPENROUTER_API_KEY = 'or-test';
    const chain = resolveLlmChain();
    expect(chain.map((c) => c.provider)).toEqual(['venice', 'openrouter', 'hfqwen']);
    const qwen = chain[2];
    expect(qwen.model).toBe(HF_QWEN_DEFAULT_MODEL);
    expect(qwen.apiKey).toBe('none');
    // Qwen disables thinking for fast JSON reviews.
    expect(qwen.bodyExtra).toEqual({ reasoning_effort: 'none' });
  });

  it('Venice embeddings are opt-in via VENICE_EMBED_ENABLE', () => {
    clearInference();
    process.env.VENICE_API_KEY = 'venice-test';
    process.env.OPENROUTER_API_KEY = 'or-test';
    // Not enabled → OpenRouter stays the embedding head.
    expect(resolveEmbeddingChain().map((c) => c.provider)).toEqual(['openrouter']);
    // Enabled → Venice takes over as head.
    process.env.VENICE_EMBED_ENABLE = '1';
    const chain = resolveEmbeddingChain();
    expect(chain.map((c) => c.provider)).toEqual(['venice', 'openrouter']);
    expect(chain[0].audioCapable).toBe(false);
  });

  it('custom CLAP embedding endpoint stays primary when configured', () => {
    clearInference();
    process.env.EMBEDDING_API_URL = 'https://clap.example.com/embed';
    process.env.VENICE_API_KEY = 'venice-test';
    process.env.VENICE_EMBED_ENABLE = '1';
    process.env.OPENROUTER_API_KEY = 'or-test';
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
