// MODULAR: Channel onboarding — the demand side of the marketplace.
//   GET  → the signed-in operator's channels.
//   POST → connect a real distribution surface.
//
// SAFE: the subscriber / view / video numbers on the returned row are written
// by the platform probe, never by this handler. `ChannelRegisterSchema` is
// `.strict()` and has no stats field, so a body that tries to self-report
// reach is rejected with a 400 instead of being silently ignored. A channel
// registered without YOUTUBE_API_KEY lands at verification_status 'pending'
// with can_buy_slots false — a mock probe can populate a demo channel but can
// never unlock the paid tier.

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
import { ChannelRegisterSchema } from '@/lib/validation';
import type { ChannelFailureCode } from '@/services/channels';

export const dynamic = 'force-dynamic';

const STATUS_FOR_FAILURE: Record<ChannelFailureCode, number> = {
  AGREEMENT_VERSION_STALE: 409,
  PLATFORM_UNSUPPORTED: 400,
  INVALID_PLATFORM_URL: 400,
  PROBE_FAILED: 502,
  CHANNEL_NOT_FOUND: 404,
};

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to manage your channels.');
  }
  const limit = parsePositiveIntParam(req.nextUrl.searchParams.get('limit'), 50, 100);
  const channels = await services().channels.listForWallet(identity.wallet, { limit });
  return successResponse(200, { channels }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to register a channel.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = ChannelRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_CHANNEL',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const result = await services().channels.register({
    ownerWallet: identity.wallet,
    platformUrl: parsed.data.platformUrl,
    platform: parsed.data.platform,
    niche: parsed.data.niche ?? null,
    ethosSummary: parsed.data.ethosSummary ?? null,
    agreementVersion: parsed.data.agreementVersion,
  });

  if (!result.ok) {
    return errorResponse(requestId, STATUS_FOR_FAILURE[result.code], result.code, result.message);
  }

  return successResponse(
    result.alreadyRegistered ? 200 : 201,
    { channel: result.channel, alreadyRegistered: result.alreadyRegistered },
    requestId,
  );
}
