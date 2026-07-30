import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
  parsePositiveIntParam,
} from '@/lib/services';
import type { ReceiptSource } from '@/services/settlement';

export const dynamic = 'force-dynamic';

const VALID_SOURCES: ReceiptSource[] = ['split', 'tip', 'play'];

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { wallet } = await ctx.params;
    const url = new URL(req.url);
    const limit = parsePositiveIntParam(url.searchParams.get('limit'), 20, 100);
    const offset = parsePositiveIntParam(url.searchParams.get('offset'), 0);
    const sourceRaw = url.searchParams.get('source');
    if (sourceRaw && !VALID_SOURCES.includes(sourceRaw as ReceiptSource)) {
      return errorResponse(rid, 400, 'INVALID_PARAM', `source must be one of ${VALID_SOURCES.join(', ')}`);
    }
    const source = (sourceRaw as ReceiptSource | null) || undefined;
    const result = await services().settlement.listReceipts(wallet, { limit, offset, source });
    return successResponse(200, result, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
