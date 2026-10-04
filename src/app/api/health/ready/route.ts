import type { NextRequest } from 'next/server';
import { jsonResponse, requestIdFor, services } from '../../../../lib/services';
import { localUploadsAllowed } from '@/lib/upload-policy';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-request-id',
      'Access-Control-Max-Age': '600',
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const svc = services();
  // Probe Arc for real-mode connectivity when RPC is configured.
  let arcInfo: Awaited<ReturnType<typeof svc.arc.getInfo>> | null = null;
  let arcReachable = true;
  try {
    arcInfo = await svc.arc.getInfo();
  } catch {
    arcReachable = false;
  }

  // The database is not an optional provider. On 2026-10-04 production Neon
  // handed out an empty `search_path`, every drizzle query failed with 42P01,
  // and this endpoint still answered 200 "ready" while the whole catalog was
  // invisible. A real round-trip is the only check that catches that class of
  // failure — an adapter's `mock: true` flag says nothing about reachability.
  let databaseReachable = true;
  let searchPath: string | null = null;
  try {
    const result = await db.execute(sql`SELECT current_setting('search_path') AS search_path`);
    const row = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
    searchPath = typeof row?.search_path === 'string' ? row.search_path : null;
    // A connection can succeed and still be unable to resolve our tables, so
    // touch a real one rather than trusting the settings read alone.
    await db.execute(sql`SELECT 1 FROM listings LIMIT 1`);
  } catch {
    databaseReachable = false;
  }
  // An empty path resolves nothing; drizzle emits unqualified names.
  const searchPathUsable = databaseReachable && !!searchPath && searchPath.trim() !== '';

  const configuredForRealArc = !svc.config.arcMock && !!process.env.PLATFORM_WALLET_PRIVATE_KEY;
  const arcDegraded = configuredForRealArc && !arcReachable;
  const dbDegraded = !databaseReachable || !searchPathUsable;
  const degraded = arcDegraded || dbDegraded;
  const status = degraded ? 'degraded' : 'ready';
  return jsonResponse(
    degraded ? 503 : 200,
    {
      success: true,
      data: {
        status,
        service: 'versions-next-api',
        version: process.env.npm_package_version || '0.0.0',
        providers: {
          database: {
            reachable: databaseReachable,
            searchPath,
            // False means unqualified queries (all of drizzle's) will fail.
            usable: searchPathUsable,
          },
          arc: {
            mock: svc.config.arcMock,
            reachable: arcReachable,
            chainId: arcInfo?.chainId ?? null,
            usdcContract: arcInfo?.usdcContract ?? null,
            platformBalance: arcInfo?.platformUsdcBalance ?? null,
            signerConfigured: !!process.env.PLATFORM_WALLET_PRIVATE_KEY,
          },
          llm: {
            mock: svc.config.llmMock,
            model: svc.config.llmModel,
            provider: svc.config.llmProvider,
            fallbacks: svc.config.llmFallbackProviders,
          },
          embedding: {
            mock: svc.config.embeddingMock,
            provider: svc.config.embeddingProvider,
          },
          gateway: { mock: svc.config.gatewayMock },
          erc8183: { mock: svc.config.erc8183Mock, contract: svc.erc8183.contractAddress },
          erc8004: { mock: svc.config.erc8004Mock, registry: svc.erc8004.registryAddress },
          ipfs: { configured: svc.config.ipfsConfigured },
          uploads: {
            localAllowed: localUploadsAllowed(),
            // True when new audio can land without writing data/uploads.
            objectStorageReady: svc.config.ipfsConfigured,
          },
          ccmixter: {
            mock: svc.config.ccmixterMock,
            configured: !svc.config.ccmixterMock,
          },
          // Distribution-surface verification. A mock probe resolves channel
          // numbers deterministically from the URL and holds verification at
          // 'pending', so it can never unlock a paid slot — the paid tier is
          // unreachable until YOUTUBE_API_KEY is set.
          channelProbe: {
            mock: svc.config.channelProbeMock,
            configured: !svc.config.channelProbeMock,
            canVerifyChannels: !svc.config.channelProbeMock,
          },
        },
      },
    },
    requestIdFor(req),
  );
}
