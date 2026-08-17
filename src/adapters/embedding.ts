// MODULAR: Audio/text embedding adapter for semantic search.
// DRY: every embedding call goes through this adapter.
// PERFORMANT: mock-first — when no provider is configured, returns
//             deterministic 512-dim vectors so the demo + tests run
//             without an external service.
// OpenRouter: set OPENROUTER_API_KEY for free text embeddings
//             (nvidia/nemotron-3-embed-1b:free). Custom CLAP service
//             via EMBEDDING_API_URL when audio-native vectors are needed.

import { createHash } from 'crypto';
import { requestJson } from '../lib/http';
import {
  fitEmbeddingDimensions,
  openRouterHeaders,
  OPENROUTER_API_BASE,
  type InferenceProvider,
} from '../lib/openrouter';

const DEFAULT_DIMENSIONS = 512;
const DEFAULT_TIMEOUT = 30_000;

export interface EmbeddingConfig {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  provider?: InferenceProvider;
  audioCapable?: boolean;
  /** Ordered text-embedding candidates tried after the primary fails. */
  fallbacks?: Array<{
    apiUrl?: string;
    apiKey?: string;
    model?: string;
    provider?: InferenceProvider;
  }>;
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
  provider: InferenceProvider;
  audioCapable: boolean;
  dimensions: number;
  model: string;
  /** Provider ids in fallback order after the primary (for health display). */
  fallbackProviders: InferenceProvider[];
}

function mockEmbedding(input: string, dimensions: number): number[] {
  const hash = createHash('sha256').update(input).digest();
  const vec: number[] = [];
  let seed = 0;
  for (let i = 0; i < dimensions; i++) {
    if (i % 32 === 0) seed = hash.readUInt32BE(i % 28);
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    vec.push((seed / 0xFFFFFFFF) * 2 - 1);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

type CustomEmbedResponse = { embedding: number[]; model?: string };
type OpenRouterEmbedResponse = {
  data?: Array<{ embedding?: number[] }>;
  model?: string;
};

export function createEmbeddingAdapter(config: EmbeddingConfig = {}): EmbeddingAdapter {
  const explicitProvider = config.provider;
  const apiUrl = config.apiUrl || '';
  const apiKey = config.apiKey || '';
  const model = config.model || 'clap-default';
  const dimensions = config.dimensions || Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_DIMENSIONS;

  const provider: InferenceProvider =
    explicitProvider ??
    (apiUrl && !apiUrl.includes('openrouter.ai')
      ? 'custom'
      : apiKey
        ? 'openrouter'
        : 'mock');

  const audioCapable = config.audioCapable ?? provider === 'custom';
  const isMock =
    provider === 'mock' ||
    (provider === 'openrouter' && !apiKey) ||
    (provider === 'custom' && !apiUrl);

  // Fallback candidates for text embeddings. Audio embedding stays on the
  // primary adapter because only a CLAP-style custom service supports it.
  const fallbackConfigs = (config.fallbacks ?? []).filter(
    (f) => f.apiUrl && f.provider !== 'custom',
  );

  async function customEmbed(payload: Record<string, unknown>): Promise<EmbeddingResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const result = await requestJson<CustomEmbedResponse>(
      apiUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, model }),
        timeoutMs: DEFAULT_TIMEOUT,
      },
      'embedding',
    );
    const embedding = fitEmbeddingDimensions(result.embedding, dimensions);
    return {
      embedding,
      mock: false,
      model: result.model || model,
    };
  }

  async function openAiCompatEmbed(
    text: string,
    targetUrl: string,
    headers: Record<string, string>,
    targetModel: string,
  ): Promise<EmbeddingResult> {
    const result = await requestJson<OpenRouterEmbedResponse>(
      targetUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: targetModel, input: text }),
        timeoutMs: DEFAULT_TIMEOUT,
      },
      'embedding',
    );
    const raw = result.data?.[0]?.embedding;
    if (!raw?.length) {
      throw new Error('Embedding response missing vector');
    }
    return {
      embedding: fitEmbeddingDimensions(raw, dimensions),
      mock: false,
      model: result.model || targetModel,
    };
  }

  async function openRouterEmbed(text: string): Promise<EmbeddingResult> {
    return openAiCompatEmbed(text, `${OPENROUTER_API_BASE}/embeddings`, openRouterHeaders(apiKey), model);
  }

  async function embedTextWithConfig(
    text: string,
    cfg: { apiUrl?: string; apiKey?: string; model?: string; provider?: InferenceProvider },
  ): Promise<EmbeddingResult> {
    if (cfg.provider === 'openrouter') {
      return openAiCompatEmbed(
        text,
        `${(cfg.apiUrl || OPENROUTER_API_BASE).replace(/\/$/, '')}/embeddings`,
        openRouterHeaders(cfg.apiKey || ''),
        cfg.model || model,
      );
    }
    // Venice and other OpenAI-compatible text endpoints.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const base = (cfg.apiUrl || '').replace(/\/$/, '');
    const endpoint = base.endsWith('/embeddings') ? base : `${base}/embeddings`;
    return openAiCompatEmbed(text, endpoint, headers, cfg.model || model);
  }

  async function embedTextLive(text: string): Promise<EmbeddingResult> {
    if (provider === 'openrouter') return openRouterEmbed(text);
    return customEmbed({ text });
  }

  return {
    mock: isMock,
    provider: isMock ? 'mock' : provider,
    audioCapable: !isMock && audioCapable,
    dimensions,
    model,
    fallbackProviders: fallbackConfigs.map((f) => f.provider ?? 'custom'),
    async embedAudio(audioUrl: string): Promise<EmbeddingResult> {
      if (isMock) {
        return { embedding: mockEmbedding('audio:' + audioUrl, dimensions), mock: true, model };
      }
      if (!audioCapable) {
        throw new Error(
          'Audio embeddings require EMBEDDING_API_URL (CLAP). OpenRouter mode embeds catalog text only.',
        );
      }
      return customEmbed({ audio_url: audioUrl });
    },
    async embedText(text: string): Promise<EmbeddingResult> {
      if (isMock) {
        return { embedding: mockEmbedding('text:' + text, dimensions), mock: true, model };
      }
      const errors: string[] = [];
      const candidates = [
        { apiUrl, apiKey, model, provider },
        ...fallbackConfigs,
      ].filter((c) => c.provider !== 'custom' || c.apiUrl);
      for (const cfg of candidates) {
        try {
          if (cfg.provider === 'custom') {
            return await customEmbed({ text });
          }
          return await embedTextWithConfig(text, cfg);
        } catch (err) {
          errors.push(`${cfg.provider}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      throw new Error(`All embedding providers failed: ${errors.join(' | ')}`);
    },
  };
}
