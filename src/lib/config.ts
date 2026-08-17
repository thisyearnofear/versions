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

  // Agent wallets. Explicit addresses override the defaults derived
  // from AGENT_KEY_SEED (or the address-only fallback when no seed).
  AGENT_WALLET_PRODUCTION: z.string().optional(),
  AGENT_WALLET_PERFORMANCE: z.string().optional(),
  AGENT_WALLET_MARKET: z.string().optional(),
  AR_WALLET: z.string().optional(),
  // Seed for deterministic per-agent testnet signing keys. When set,
  // each agent holds a wallet the arc adapter can sign with.
  AGENT_KEY_SEED: z.string().optional(),

  // IPFS (Pinata JWT is read directly in src/lib/ipfs.ts)
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY: z.string().optional(),

  // Server tunables
  JSON_BODY_LIMIT: z.string().default('256kb'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  SEMANTIC_CACHE_TTL_MS: z.coerce.number().int().positive().default(30000),
  AUDIO_CACHE_TTL_MS: z.coerce.number().int().positive().default(45000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_AUDIO_MAX: z.coerce.number().int().positive().default(30),

  // CORS (reserved — not yet wired into route handlers)
  ALLOWED_ORIGINS: z.string().optional(),

  // Monitoring — wired via instrumentation.ts (Sentry init, env-gated;
  // inert unless SENTRY_DSN is set) and /admin/vitals + /api/v1/vitals.
  SENTRY_DSN: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),

  // Cron — shared secret that guards /api/cron/sweep (settlement retries,
  // outbox drain, retention deletes). When unset the route logs a warning
  // and fails open so existing deploys keep ticking; once set, requests
  // must send it as the `x-cron-secret` header.
  CRON_SECRET: z.string().optional(),
});

// During `next build`, Next.js evaluates server-component / route module graphs
// (this config is transitively imported, e.g. via the feed service) and executes
// top-level code. Docker builds have no server secrets on disk (.dockerignore
// excludes .env, and baking creds into image layers would leak DB/auth secrets
// via `docker history`). So relax the REQUIRED keys during the build phase only;
// runtime still validates strictly and fails fast if DATABASE_URL/NEXTAUTH_SECRET
// are missing. Next sets NEXT_PHASE=PHASE_PRODUCTION_BUILD during `next build`.
const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build';

// MODULAR: docker compose env_file materializes unset vars as `KEY=` (empty
// string), and dotenv-style files do the same for commented-out lines. Treat
// empty as absent so optional URL fields don't fail `z.string().url().optional()`
// at module load — the class of bug that 500'd /api/cron/sweep on deploy when
// the server .env carried a placeholder `LLM_API_URL=`. Coerced number fields
// (UPSTREAM_TIMEOUT_MS, etc.) also fall through to their defaults instead of
// NaN-ing. Required fields still fail (empty → undefined → "Required").
const envInput = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
);

export const env = (isNextBuild ? envSchema.partial() : envSchema).parse(
  envInput,
) as z.infer<typeof envSchema>;

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
