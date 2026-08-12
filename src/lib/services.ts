// MODULAR: Lazy-initialized service singletons.
// CLEAN: route handlers ask for `services.arc`, `services.submissions`, etc.
//        and get a memoized instance. The first call wires the adapter
//        graph (arc → submissions/settlement → curation → agents/ar,
//        feed is independent).
// PERFORMANT: instantiation is deferred until the first request. Build
//             does NOT touch the DB or the LLM API because Next.js
//             only runs the module body if a route is invoked.
// DRY: every route imports from here; no other module creates services.

import type { NextRequest } from 'next/server';
import path from 'node:path';
import { createArcAdapter, type ArcAdapter } from '../adapters/arc';
import { createErc8183Adapter, type Erc8183Adapter } from '../adapters/erc8183';
import { createErc8004Adapter, type Erc8004Adapter, type AgentLabel } from '../adapters/erc8004';
import { createTipSettlementService, type TipSettlementService } from '../services/tips';
import { createLlmAdapter } from '../adapters/llm';
import { createEmbeddingAdapter } from '../adapters/embedding';
import { createSubmissionsService, type SubmissionsService } from '../services/submissions';
import { createSettlementService, type SettlementService } from '../services/settlement';
import { createCurationService, type CurationService } from '../services/curation';
import { createFeedService, type FeedService } from '../services/feed';
import { createEmbeddingService, type EmbeddingService } from '../services/embeddings';
import { createAgentService, type AgentService } from '../services/agents';
import { createArService, type ArService } from '../services/ar';
import { createSweeper, type Sweeper } from '../services/settlement-sweeper';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { createIpfsFromEnv, type PinataClient } from './ipfs';
import { createListenerService, type ListenerService } from '../services/listeners';
import { createSupervisorDashboardService, type SupervisorDashboardService } from '../services/supervisor';
import { log } from './logger';

// MODULAR: deterministic agent wallets when env is missing. With
// AGENT_KEY_SEED set, each agent gets a derived address whose key
// the arc adapter can sign with; without a seed the address is a
// stable valid-format identity (no spendable key exists).
import { buildSignerMap, deterministicAddress } from './signers';

export interface ServiceRegistry {
  arc: ArcAdapter;
  erc8183: Erc8183Adapter;
  erc8004: Erc8004Adapter;
  tips: TipSettlementService;
  submissions: SubmissionsService;
  settlement: SettlementService;
  curation: CurationService;
  feed: FeedService;
  embeddings: EmbeddingService;
  agents: AgentService;
  ar: ArService;
  sweeper: Sweeper;
  listeners: ListenerService;
  supervisor: SupervisorDashboardService;
  audioLimiter: RateLimiter;
  generalLimiter: RateLimiter;
  ipfs: PinataClient;
  config: {
    platformWallet: string | null;
    arWallet: string;
    agentWallets: string[];
    llmModel: string;
    arcMock: boolean;
    erc8183Mock: boolean;
    erc8004Mock: boolean;
    llmMock: boolean;
    gatewayMock: boolean;
    embeddingMock: boolean;
    uploadDir: string;
    ipfsConfigured: boolean;
  };
}

let registry: ServiceRegistry | null = null;

function build(): ServiceRegistry {
  const platformWallet = process.env.PLATFORM_WALLET || null;
  const arcRpcUrl = process.env.ARC_RPC_URL || '';
  const arcUsdcContract = process.env.ARC_USDC_CONTRACT || '';
  const llmApiUrl = process.env.LLM_API_URL || '';
  const llmApiKey = process.env.LLM_API_KEY || '';
  const llmModel = process.env.LLM_MODEL || 'gpt-4o-mini';

  // MODULAR: seed-derived agent signers. AGENT_KEY_SEED gives each
  // agent a testnet wallet the arc adapter can sign with; explicit
  // AGENT_WALLET_* env vars still override the address (sends from an
  // overridden address without a matching key settle as mock).
  const agentKeySeed = process.env.AGENT_KEY_SEED || '';
  const agentLabels = ['production', 'performance', 'market', 'ar'];
  const { signers, addresses: derivedAddresses } = buildSignerMap({
    platformWalletPrivateKey: process.env.PLATFORM_WALLET_PRIVATE_KEY || undefined,
    agentKeySeed: agentKeySeed || undefined,
    labels: agentLabels,
  });
  const defaultWallet = (label: string) =>
    derivedAddresses[label] ?? deterministicAddress(label);

  const agentWallets: string[] = [
    process.env.AGENT_WALLET_PRODUCTION || defaultWallet('production'),
    process.env.AGENT_WALLET_PERFORMANCE || defaultWallet('performance'),
    process.env.AGENT_WALLET_MARKET || defaultWallet('market'),
  ];
  const arWallet = process.env.AR_WALLET || defaultWallet('ar');

  const arc = createArcAdapter({
    rpcUrl: arcRpcUrl || undefined,
    usdcContract: arcUsdcContract || undefined,
    platformWallet: platformWallet || undefined,
    platformWalletPrivateKey: process.env.PLATFORM_WALLET_PRIVATE_KEY || undefined,
    signers,
  });

  // MODULAR: ERC-8183 license jobs. Client = platform (brokers for
  // supervisor). Provider = Market agent when seed-derived, else
  // platform — the clearing agent that delivers the license package.
  const marketLabel = 'market';
  const marketAddress = (derivedAddresses[marketLabel] ?? agentWallets[2] ?? platformWallet ?? '').toLowerCase();
  const providerKey =
    (marketAddress && signers[marketAddress]) ||
    process.env.PLATFORM_WALLET_PRIVATE_KEY ||
    undefined;
  const erc8183 = createErc8183Adapter({
    rpcUrl: arcRpcUrl || undefined,
    usdcContract: arcUsdcContract || undefined,
    clientPrivateKey: process.env.PLATFORM_WALLET_PRIVATE_KEY || undefined,
    providerPrivateKey: providerKey,
  });

  const erc8004 = createErc8004Adapter({
    rpcUrl: arcRpcUrl || undefined,
    agentWallets: [
      { label: 'production' as AgentLabel, wallet: agentWallets[0]! },
      { label: 'performance' as AgentLabel, wallet: agentWallets[1]! },
      { label: 'market' as AgentLabel, wallet: agentWallets[2]! },
      { label: 'ar' as AgentLabel, wallet: arWallet },
    ],
  });

  // MODULAR: nanotip batch settlement. Verified x402 proofs queue in
  // the DB; the tips service aggregates them per artist and settles
  // each batch as one USDC transfer through the arc adapter. Mock
  // status follows the arc adapter (no separate credentials).
  const tips = createTipSettlementService({ arc, platformWallet });

  const submissions = createSubmissionsService({
    arc,
    platformWallet: platformWallet ?? undefined,
    usdcContract: arcUsdcContract || undefined,
  });
  const settlement = createSettlementService({ arc: arc as ArcAdapter, platformWallet: platformWallet ?? undefined });
  const curation = createCurationService({ settlement });
  const embeddingAdapter = createEmbeddingAdapter();
  const feed = createFeedService({ embedding: embeddingAdapter });
  const embeddings = createEmbeddingService(embeddingAdapter);
  const llm = createLlmAdapter({ apiUrl: llmApiUrl || undefined, apiKey: llmApiKey || undefined, model: llmModel });
  const agents = createAgentService({ llm, settlement, agentWallets });
  const ar = createArService({ arc, arWallet, llm });
  const listeners = createListenerService();
  const supervisor = createSupervisorDashboardService();
  const sweeper = createSweeper({ settlement, tips });
  const ipfs = createIpfsFromEnv();

  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
  const audioMax = Number(process.env.RATE_LIMIT_AUDIO_MAX) || 30;
  const audioLimiter = createRateLimiter({ windowMs, max: audioMax, label: 'audio' });
  const generalLimiter = createRateLimiter({ windowMs, max: audioMax * 4, label: 'general' });

  // MODULAR: uploads directory. Default /tmp/uploads when env is
  // missing; in production set UPLOAD_DIR to a persistent path.
  const uploadDir =
    process.env.UPLOAD_DIR ||
    (process.env.VERCEL ? '/tmp/uploads' : path.resolve(process.cwd(), 'data', 'uploads'));

  return {
    arc,
    erc8183,
    erc8004,
    tips,
    submissions,
    settlement,
    curation,
    feed,
    embeddings,
    agents,
    ar,
    listeners,
    supervisor,
    sweeper,
    audioLimiter,
    generalLimiter,
    ipfs,
    config: {
      platformWallet,
      arWallet,
      agentWallets,
      llmModel,
      arcMock: !arcRpcUrl,
      erc8183Mock: erc8183.mock,
      erc8004Mock: erc8004.mock,
      llmMock: !llmApiKey,
      // Tips settle through the arc adapter; the flag name is kept
      // for the health endpoint contract.
      gatewayMock: !arcRpcUrl,
      embeddingMock: embeddingAdapter.mock,
      uploadDir,
      ipfsConfigured: ipfs.isConfigured(),
    },
  };
}

export function services(): ServiceRegistry {
  if (!registry) {
    registry = build();
    log.info('services initialized', {
      arcMock: registry.config.arcMock,
      llmMock: registry.config.llmMock,
      uploadDir: registry.config.uploadDir,
    });
  }
  return registry;
}

// ── response envelope helpers ───────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  Vary: 'Origin',
};

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const payload = JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(payload)),
      'x-request-id': requestId,
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function successResponse(status: number, data: unknown, requestId: string): Response {
  return jsonResponse(status, { success: true, data }, requestId);
}

export function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return jsonResponse(
    status,
    { success: false, error: { code, message, details: details ?? null, requestId } },
    requestId,
  );
}

export function corsPreflight(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-request-id',
      'Access-Control-Max-Age': '600',
      'x-request-id': requestId,
    },
  });
}

export function rateLimitedResponse(requestId: string): Response {
  return errorResponse(requestId, 429, 'RATE_LIMITED', 'Too many requests — try again in 60s');
}

// ── request helpers ────────────────────────────────────

import { randomUUID } from 'crypto';

export function requestIdFor(req: NextRequest): string {
  const incoming = req.headers.get('x-request-id');
  if (incoming && incoming.trim()) return incoming.trim();
  return randomUUID();
}

export function clientIpFor(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return null;
}

// MODULAR: extract headers from a NextRequest as a plain object for
// adapters that expect Node-style headers (rate limiter, etc).
export function headerBag(req: NextRequest): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  req.headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

// MODULAR: parse a small integer from a query string value with a
// default + cap. Used by paginated GET routes.
export function parsePositiveIntParam(
  raw: string | null,
  fallback: number,
  max?: number,
): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) return fallback;
  if (max != null && n > max) return max;
  return n;
}

// MODULAR: shared audio mime map. Mirrors the legacy server.
export const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};
