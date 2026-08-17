// MODULAR: Inference providers. One API key enables free-tier
// LLM (agent reviews) + text embeddings (brief search). OpenAI-compatible
// chat + embeddings endpoints — https://openrouter.ai/docs
//
// DEMO HARDENING: agent reviews and brief-search embeddings now run
// through an ordered provider chain (Venice primary → HF Qwen →
// OpenRouter) so a single provider's rate limit never silently degrades
// the demo to mock. resolveLlmChain()/resolveEmbeddingChain() build the
// chain from env; resolveLlmConfig()/resolveEmbeddingConfig() keep
// returning the head entry for display.

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

/** Free model with JSON / structured output support for agent reviews. */
export const OPENROUTER_DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b:free';

/** Free text embedding model (catalog + brief vectors). */
export const OPENROUTER_DEFAULT_EMBED_MODEL = 'nvidia/nemotron-3-embed-1b:free';

// Venice: OpenAI-compatible, keyed. Verified JSON output + embeddings.
export const VENICE_API_BASE = 'https://api.venice.ai/api/v1';
export const VENICE_DEFAULT_LLM_MODEL = 'venice-uncensored';
export const VENICE_DEFAULT_EMBED_MODEL = 'text-embedding-bge-m3';

// HF public endpoint for Qwen3.8-27B: OpenAI-compatible, no key needed
// (any string works). Rate-limited ~30 req/min per IP; retired after
// launch buzz — treat as a backup, not a primary.
export const HF_QWEN_API_BASE =
  'https://g9hnto0u7lvbu837.us-east-2.aws.endpoints.huggingface.cloud/v1';
export const HF_QWEN_DEFAULT_MODEL = 'Qwen/Qwen3.8-27B';

export type InferenceProvider = 'openrouter' | 'custom' | 'venice' | 'hfqwen' | 'mock';

export interface ResolvedLlmConfig {
  provider: InferenceProvider;
  apiUrl: string | null;
  apiKey: string | null;
  model: string;
  /** Extra body fields for this provider (e.g. reasoning_effort for Qwen). */
  bodyExtra?: Record<string, unknown>;
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

/**
 * Ordered live-provider chain for LLM calls. Head = primary; the adapter
 * walks the chain on failure. Providers are opt-in via env:
 *   1. custom    — LLM_API_KEY (+ LLM_API_URL / LLM_MODEL)
 *   2. venice    — VENICE_API_KEY (reliable, keyed)
 *   3. openrouter — OPENROUTER_API_KEY (free-tier, rate-limited)
 *   4. hfqwen    — HF_QWEN_API_URL (keyless public endpoint; free but
 *                  rate-limited ~30 req/min and retired after launch
 *                  buzz, hence last resort)
 * Returns [] when nothing is configured (adapter then runs mock).
 */
export function resolveLlmChain(): ResolvedLlmConfig[] {
  const chain: ResolvedLlmConfig[] = [];

  const llmApiKey = process.env.LLM_API_KEY?.trim() || '';
  const llmApiUrl = process.env.LLM_API_URL?.trim() || '';
  const model = process.env.LLM_MODEL?.trim() || '';
  if (llmApiKey) {
    chain.push({
      provider: 'custom',
      apiUrl: llmApiUrl || 'https://api.openai.com/v1',
      apiKey: llmApiKey,
      model: model || 'gpt-4o-mini',
    });
  }

  const veniceKey = process.env.VENICE_API_KEY?.trim() || '';
  if (veniceKey) {
    chain.push({
      provider: 'venice',
      apiUrl: process.env.VENICE_API_URL?.trim() || VENICE_API_BASE,
      apiKey: veniceKey,
      model: process.env.VENICE_MODEL?.trim() || VENICE_DEFAULT_LLM_MODEL,
    });
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  if (openRouterKey && !chain.some((c) => c.provider === 'openrouter')) {
    chain.push({
      provider: 'openrouter',
      apiUrl: llmApiUrl || OPENROUTER_API_BASE,
      apiKey: openRouterKey,
      model: model || OPENROUTER_DEFAULT_LLM_MODEL,
    });
  }

  const hfUrl = process.env.HF_QWEN_API_URL?.trim() || '';
  if (hfUrl) {
    chain.push({
      provider: 'hfqwen',
      apiUrl: hfUrl,
      apiKey: process.env.HF_QWEN_API_KEY?.trim() || 'none',
      model: process.env.HF_QWEN_MODEL?.trim() || HF_QWEN_DEFAULT_MODEL,
      // Thinking off: fast, clean JSON answers for agent reviews.
      bodyExtra: { reasoning_effort: 'none' },
    });
  }

  return chain;
}

export function resolveLlmConfig(): ResolvedLlmConfig {
  const head = resolveLlmChain()[0];
  if (head) return head;

  const model = process.env.LLM_MODEL?.trim() || '';
  return {
    provider: 'mock',
    apiUrl: null,
    apiKey: null,
    model: model || OPENROUTER_DEFAULT_LLM_MODEL,
  };
}

/**
 * Ordered live-provider chain for text embeddings. Same shape as the LLM
 * chain; providers are opt-in via env:
 *   1. custom     — EMBEDDING_API_URL (+ EMBEDDING_API_KEY / EMBEDDING_MODEL)
 *   2. venice     — VENICE_API_KEY (bge-m3, 1024-dim → fitted to column)
 *   3. openrouter — OPENROUTER_API_KEY
 * NOTE: switching the head provider changes the embedding space — re-embed
 * the published catalog (POST /api/v1/embeddings/backfill?force=1) after.
 */
export function resolveEmbeddingChain(): ResolvedEmbeddingConfig[] {
  const chain: ResolvedEmbeddingConfig[] = [];

  const embedUrl = process.env.EMBEDDING_API_URL?.trim() || '';
  const embedKey = process.env.EMBEDDING_API_KEY?.trim() || '';
  const model = process.env.EMBEDDING_MODEL?.trim() || '';
  if (embedUrl) {
    chain.push({
      provider: 'custom',
      apiUrl: embedUrl,
      apiKey: embedKey,
      model: model || 'clap-default',
      audioCapable: true,
    });
  }

  const veniceKey = process.env.VENICE_API_KEY?.trim() || '';
  // Venice embeddings are OPT-IN (VENICE_EMBED_ENABLE=1): they use bge-m3,
  // a different vector space than OpenRouter's nemotron, so enabling them
  // implicitly while setting VENICE_API_KEY for the LLM would silently
  // mix spaces and break similarity search against existing catalog rows.
  const veniceEmbedEnabled = /^(1|true|yes|on)$/i.test(
    process.env.VENICE_EMBED_ENABLE?.trim() || '',
  );
  if (veniceKey && veniceEmbedEnabled) {
    chain.push({
      provider: 'venice',
      apiUrl:
        process.env.VENICE_EMBED_API_URL?.trim() ||
        `${VENICE_API_BASE}/embeddings`,
      apiKey: veniceKey,
      model: process.env.VENICE_EMBED_MODEL?.trim() || VENICE_DEFAULT_EMBED_MODEL,
      audioCapable: false,
    });
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  if (openRouterKey) {
    chain.push({
      provider: 'openrouter',
      apiUrl: OPENROUTER_API_BASE,
      apiKey: openRouterKey,
      model: model || OPENROUTER_DEFAULT_EMBED_MODEL,
      audioCapable: false,
    });
  }

  return chain;
}

export function resolveEmbeddingConfig(): ResolvedEmbeddingConfig {
  const head = resolveEmbeddingChain()[0];
  if (head) return head;

  const model = process.env.EMBEDDING_MODEL?.trim() || '';
  return {
    provider: 'mock',
    apiUrl: null,
    apiKey: null,
    model: model || OPENROUTER_DEFAULT_EMBED_MODEL,
    audioCapable: false,
  };
}
