import type { NextRequest } from 'next/server';
import {
  services,
  errorResponse,
  corsPreflight,
  rateLimitedResponse,
  requestIdFor,
  clientIpFor,
  headerBag,
  AUDIO_MIME,
} from '@/lib/services';
import path from 'node:path';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

function safeUploadPath(uploadDir: string, filename: string): string | null {
  const base = path.basename(filename);
  if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) return null;
  return path.join(uploadDir, base);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ filename: string }> }) {
  const rid = requestIdFor(req);
  const svc = services();
  if (!svc.audioLimiter.allow({ headers: headerBag(req) }, clientIpFor(req))) {
    return rateLimitedResponse(rid);
  }
  try {
    const { filename } = await ctx.params;
    const safe = safeUploadPath(svc.config.uploadDir, filename);
    if (!safe) return errorResponse(rid, 400, 'BAD_FILENAME', 'Invalid filename');
    if (!fs.existsSync(safe)) return errorResponse(rid, 404, 'NOT_FOUND', 'Audio not found');
    const ext = path.extname(safe).toLowerCase();
    const data = fs.readFileSync(safe);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': AUDIO_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'x-request-id': rid,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
