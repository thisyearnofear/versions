// MODULAR: License receipt + settlement.
//   GET  → the license receipt (status, fee, tx, arcscan-able hash).
//   POST → settle an unpaid license: route orchestrates the Arc USDC
//          transfer (platform-brokered in this first cut) and marks it paid.
//          Idempotent: already-paid returns the stored state.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { resolveSupervisorIdentity } from '@/lib/supervisor-identity';

export const dynamic = 'force-dynamic';

async function identityOr401(req: NextRequest, requestId: string) {
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return { resp: errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to view a license.') };
  }
  return { identity };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(req);
  const ida = await identityOr401(req, requestId);
  if (ida.resp) return ida.resp;
  const { id } = await ctx.params;
  const license = await services().supervisor.getLicense(id, ida.identity!.wallet);
  if (!license) return errorResponse(requestId, 404, 'NOT_FOUND', 'License not found.');
  return successResponse(200, { license }, requestId);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(req);
  const ida = await identityOr401(req, requestId);
  if (ida.resp) return ida.resp;
  const { id } = await ctx.params;

  const before = await services().supervisor.getLicense(id, ida.identity!.wallet);
  if (!before) return errorResponse(requestId, 404, 'NOT_FOUND', 'License not found.');
  if (before.status === 'paid') {
    return successResponse(200, { license: before }, requestId);
  }

  // Settle via Arc USDC: platform signer → the take's artist. Mock-first:
  // without a reachable RPC / signer key, this returns a deterministic mock
  // hash flagged `mock:true` (the demo loop's standard behavior).
  const to = before.artist_wallet ?? `0x${'0'.repeat(40)}`;
  const tx = await services().arc.sendTransfer({ from: '', to, amountUsdc: before.fee_usdc });
  const license = await services().supervisor.markLicensePaid(id, ida.identity!.wallet, {
    txHash: tx.hash,
    mock: tx.mock,
  });

  return successResponse(200, { license, settled: { txHash: tx.hash, mock: tx.mock } }, requestId);
}