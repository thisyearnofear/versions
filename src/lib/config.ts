import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().optional(),

  // Arc L1
  ARC_RPC_URL: z.string().url().optional(),
  ARC_USDC_CONTRACT: z.string().optional(),
  PLATFORM_WALLET: z.string().optional(),
  // Optional: server-side signer for automated settlement. When absent,
  // settlement falls back to mock mode (deterministic hash) so tests
  // and demos run without a hot wallet.
  PLATFORM_WALLET_PRIVATE_KEY: z.string().optional(),

  // LLM
  LLM_API_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o-mini'),

  // Agent wallets (Circle programmable wallets)
  AGENT_WALLET_PRODUCTION: z.string().optional(),
  AGENT_WALLET_PERFORMANCE: z.string().optional(),
  AGENT_WALLET_MARKET: z.string().optional(),
  AR_WALLET: z.string().optional(),

  // IPFS (Pinata JWT is read directly in src/lib/ipfs.ts)
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY: z.string().optional(),

  // Circle Gateway (x402 nanopayments)
  GATEWAY_API_URL: z.string().url().optional(),
  GATEWAY_API_KEY: z.string().optional(),
  GATEWAY_BATCH_INTERVAL_MS: z.coerce.number().int().positive().default(500),

  // Server tunables
  JSON_BODY_LIMIT: z.string().default('256kb'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  SEMANTIC_CACHE_TTL_MS: z.coerce.number().int().positive().default(30000),
  AUDIO_CACHE_TTL_MS: z.coerce.number().int().positive().default(45000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_AUDIO_MAX: z.coerce.number().int().positive().default(30),

  // CORS (reserved — not yet wired into route handlers)
  ALLOWED_ORIGINS: z.string().optional(),

  // Monitoring (reserved — not yet wired into error tracking or product analytics)
  SENTRY_DSN: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const config = {
  submissionFee: '0.50',
  curatorShare: 0.70,
  platformShare: 0.20,
  musicbrainzShare: 0.10,
  publishThreshold: 3,
  claimTtlHours: 24,
  listenerFee: '0.001',
  artistPayout: '0.0005',
} as const;
