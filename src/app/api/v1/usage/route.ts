// MODULAR: Usage — the free tier's compliance record and the data flywheel.
//   POST → log a delivery (which channel used which listing, where).
//   GET  → compliance rollup + reporter split (no wallet required — this is
//          the sales proof for the paid side: \"this catalog gets used N×/month\").

import { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
  parsePositiveIntParam,
} from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { UsageReportSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const listingId = searchParams.get('listingId');
  const channelId = searchParams.get('channelId');
  const slotId = searchParams.get('slotId');
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 100);
  const offset = parsePositiveIntParam(searchParams.get('offset'), 0);

  // Scoped list
  if (listingId) {
    const rows = await services().usage.listForListing(listingId, { limit, offset });
    return successResponse(200, { usage: rows }, requestId);
  }
  if (channelId) {
    const rows = await services().usage.listForChannel(channelId, { limit });
    return successResponse(200, { usage: rows }, requestId);
  }
  if (slotId) {
    const rows = await services().usage.listForSlot(slotId, { limit });
    return successResponse(200, { usage: rows }, requestId);
  }

  // Catalog rollup + compliance on demand
  const summary = await services().usage.summary({ sinceIso: since });
  return successResponse(200, { summary }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to report where a placement ran.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = UsageReportSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_USAGE',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const result = await services().usage.log({
    listingId: parsed.data.listingId,
    channelId: parsed.data.channelId,
    reporterWallet: identity.wallet,
    slotId: parsed.data.slotId ?? null,
    attributionCode: parsed.data.attributionCode ?? null,
    videoUrl: parsed.data.videoUrl ?? null,
    externalContentId: parsed.data.externalContentId ?? null,
    impressions: parsed.data.impressions,
    clicks: parsed.data.clicks,
    occurredAt: parsed.data.occurredAt ?? null,
  });

  if (!result.ok) {
    const map: Record<string, number> = {
      LISTING_NOT_FOUND: 404,
      CHANNEL_NOT_FOUND: 404,
      CHANNEL_NOT_OWNED: 403,
      SLOT_REQUIRED: 400,
      SLOT_NOT_FOUND: 404,
      SLOT_NOT_FOR_LISTING: 400,
      PAID_LISTING_NEEDS_SLOT: 400,
      SLOT_NOT_ACTIVE: 409,
      BUDGET_EXHAUSTED: 409,
      INVALID_IMPRESSIONS: 400,
      INVALID_VIDEO_URL: 400,
    };
    return errorResponse(requestId, map[result.code] ?? 400, result.code, result.message);
  }
  return successResponse(201, { usage: result.usage }, requestId);
}
