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
import { createGatewayAdapter, type GatewayAdapter } from '../adapters/gateway';
import { createLlmAdapter, type LlmAdapter } from '../adapters/llm';
import { createSubmissionsService, type SubmissionsService } from '../services/submissions';
import { createSettlementService, type SettlementService } from '../services/settlement';
import { createCurationService, type CurationService } from '../services/curation';
import { createFeedService, type FeedService } from '../services/feed';
import { createAgentService, type AgentService } from '../services/agents';
import { createArService, type ArService } from '../services/ar';
import { createSweeper, type Sweeper } from '../services/settlement-sweeper';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { createIpfsFromEnv, type PinataClient } from './ipfs';
import { createListenerService, type ListenerService } from '../services/listeners';
import { log } from './logger';

// MODULAR: deterministic agent wallets when env is missing.
// Matches the legacy proxy-server.js behaviour so the same wallet
// shows up across restarts when the operator hasn't configured keys.
import { createHash } from 'crypto';
function deterministicAgentWallet(label: string, slice: number): string {
  return (
    'agent_' +
    label +
    '_' +
    createHash('sha256').update(label).digest('hex').slice(0, slice)
  );
}

export interface ServiceRegistry {
  arc: ArcAdapter;
  gateway: GatewayAdapter;
  submissions: SubmissionsService;
  settlement: SettlementService;
  curation: CurationService;
  feed: FeedService;
  agents: AgentService;
  ar: ArService;
  sweeper: Sweeper;
  listeners: ListenerService;
  audioLimiter: RateLimiter;
  generalLimiter: RateLimiter;
  ipfs: PinataClient;
  config: {
    platformWallet: string | null;
    arWallet: string;
    agentWallets: string[];
    llmModel: string;
    arcMock: boolean;
    llmMock: boolean;
    gatewayMock: boolean;
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

  const agentWallets: string[] = [
    process.env.AGENT_WALLET_PRODUCTION || deterministicAgentWallet('production', 32),
    process.env.AGENT_WALLET_PERFORMANCE || deterministicAgentWallet('performance', 30),
    process.env.AGENT_WALLET_MARKET || deterministicAgentWallet('market', 34),
  ];
  const arWallet =
    process.env.AR_WALLET || deterministicAgentWallet('ar', 35);

  const arc = createArcAdapter({
    rpcUrl: arcRpcUrl || undefined,
    usdcContract: arcUsdcContract || undefined,
    platformWallet: platformWallet || undefined,
  });

  // MODULAR: Circle Gateway for sub-cent USDC nanopayments. Mock-first
  // (same pattern as the arc adapter): when GATEWAY_API_URL is missing
  // the adapter returns deterministic mock responses so the x402 tip
  // route and TipButton work without credentials. Setting GATEWAY_API_URL
  // + GATEWAY_API_KEY in env switches to real batched settlement.
  const gateway = createGatewayAdapter({
    apiUrl: process.env.GATEWAY_API_URL || undefined,
    apiKey: process.env.GATEWAY_API_KEY || undefined,
    network: 'arc-testnet',
    usdcContract: arcUsdcContract || undefined,
    batchIntervalMs: Number(process.env.GATEWAY_BATCH_INTERVAL_MS) || 500,
  });

  const submissions = createSubmissionsService({ arc, platformWallet: platformWallet ?? undefined });
  const settlement = createSettlementService({ arc: arc as ArcAdapter, platformWallet: platformWallet ?? undefined });
  const curation = createCurationService({ settlement });
  const feed = createFeedService();
  const llm = createLlmAdapter({ apiUrl: llmApiUrl || undefined, apiKey: llmApiKey || undefined, model: llmModel });
  const agents = createAgentService({ llm, settlement, agentWallets });
  const ar = createArService({ arc, arWallet });
  const listeners = createListenerService();
  const sweeper = createSweeper({ settlement });
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
    gateway,
    submissions,
    settlement,
    curation,
    feed,
    agents,
    ar,
    listeners,
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
      llmMock: !llmApiKey,
      gatewayMock: !process.env.GATEWAY_API_URL,
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
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
