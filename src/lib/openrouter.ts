// MODULAR: OpenRouter inference defaults. One API key enables free-tier
// LLM (agent reviews) + text embeddings (brief search). OpenAI-compatible
// chat + embeddings endpoints — https://openrouter.ai/docs

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

/** Free model with JSON / structured output support for agent reviews. */
export const OPENROUTER_DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b:free';

/** Free text embedding model (catalog + brief vectors). */
export const OPENROUTER_DEFAULT_EMBED_MODEL = 'nvidia/nemotron-3-embed-1b:free';

export type InferenceProvider = 'openrouter' | 'custom' | 'mock';

export interface ResolvedLlmConfig {
  provider: InferenceProvider;
  apiUrl: string | null;
  apiKey: string | null;
  model: string;
}

export interface ResolvedEmbeddingConfig {
  provider: InferenceProvider;
  apiUrl: string | null;
  apiKey: string | null;
  model: string;
  /** CLAP-style audio endpoint; OpenRouter is text-only. */
  audioCapable: boolean;
}

export function openRouterHeaders(apiKey: string): Record<string, string> {
  const site =
    process.env.OPENROUTER_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    'https://versions.persidian.com';
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': site,
    'X-Title': process.env.OPENROUTER_APP_NAME || 'VERSIONS',
  };
}

/** Fit provider vectors into our pgvector column (512-dim). */
export function fitEmbeddingDimensions(vec: number[], target: number): number[] {
  if (target <= 0) return vec;
  let out: number[];
  if (vec.length === target) {
    out = vec;
  } else if (vec.length > target) {
    out = vec.slice(0, target);
  } else {
    out = [...vec, ...Array(target - vec.length).fill(0)];
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

export function resolveLlmConfig(): ResolvedLlmConfig {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  const llmApiKey = process.env.LLM_API_KEY?.trim() || '';
  const llmApiUrl = process.env.LLM_API_URL?.trim() || '';
  const model = process.env.LLM_MODEL?.trim() || '';

  // Explicit custom endpoint wins.
  if (llmApiKey) {
    return {
      provider: 'custom',
      apiUrl: llmApiUrl || 'https://api.openai.com/v1',
      apiKey: llmApiKey,
      model: model || 'gpt-4o-mini',
    };
  }

  if (openRouterKey) {
    return {
      provider: 'openrouter',
      apiUrl: llmApiUrl || OPENROUTER_API_BASE,
      apiKey: openRouterKey,
      model: model || OPENROUTER_DEFAULT_LLM_MODEL,
    };
  }

  return {
    provider: 'mock',
    apiUrl: null,
    apiKey: null,
    model: model || OPENROUTER_DEFAULT_LLM_MODEL,
  };
}

export function resolveEmbeddingConfig(): ResolvedEmbeddingConfig {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  const embedUrl = process.env.EMBEDDING_API_URL?.trim() || '';
  const embedKey = process.env.EMBEDDING_API_KEY?.trim() || '';
  const model = process.env.EMBEDDING_MODEL?.trim() || '';

  // Custom CLAP / hosted embedding service (audio-capable).
  if (embedUrl) {
    return {
      provider: 'custom',
      apiUrl: embedUrl,
      apiKey: embedKey,
      model: model || 'clap-default',
      audioCapable: true,
    };
  }

  if (openRouterKey) {
    return {
      provider: 'openrouter',
      apiUrl: OPENROUTER_API_BASE,
      apiKey: openRouterKey,
      model: model || OPENROUTER_DEFAULT_EMBED_MODEL,
      audioCapable: false,
    };
  }

  return {
    provider: 'mock',
    apiUrl: null,
    apiKey: null,
    model: model || OPENROUTER_DEFAULT_EMBED_MODEL,
    audioCapable: false,
  };
}
