import type { NextRequest } from 'next/server';
import { jsonResponse, requestIdFor } from '../../../../lib/services';

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
  return jsonResponse(
    200,
    {
      success: true,
      data: {
        status: 'ok',
        service: 'versions-next-api',
        version: process.env.npm_package_version || '0.0.0',
      },
    },
    requestIdFor(req),
  );
}
