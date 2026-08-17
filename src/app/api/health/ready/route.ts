import type { NextRequest } from 'next/server';
import { jsonResponse, requestIdFor, services } from '../../../../lib/services';

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
  const configuredForRealArc = !svc.config.arcMock && !!process.env.PLATFORM_WALLET_PRIVATE_KEY;
  const degraded = configuredForRealArc && !arcReachable;
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
          ccmixter: {
            mock: svc.config.ccmixterMock,
            configured: !svc.config.ccmixterMock,
          },
        },
      },
    },
    requestIdFor(req),
  );
}
