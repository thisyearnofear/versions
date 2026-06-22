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
  return jsonResponse(
    200,
    {
      success: true,
      data: {
        status: 'ready',
        service: 'versions-next-api',
        version: process.env.npm_package_version || '0.0.0',
        providers: {
          arc: { mock: svc.config.arcMock },
          llm: { mock: svc.config.llmMock, model: svc.config.llmModel },
        },
      },
    },
    requestIdFor(req),
  );
}
