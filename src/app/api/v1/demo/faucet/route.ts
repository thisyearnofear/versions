// MODULAR: Demo faucet — sends a small fixed amount of testnet USDC from the
// platform treasury to an arbitrary address so a throwaway demo wallet can
// cover the on-chain submission fee + gas on Arc. Testnet-only; the amount is
// a fixed constant (not caller-controlled) and the route is rate-limited per
// IP, so it can't be abused to drain the treasury.
//
// CLEAN: returns the transfer result ({ hash, mock }) so the caller can wait
//        for finality before spending. In mock mode (no ARC_RPC_URL) the arc
//        adapter returns a deterministic synthetic hash and `mock: true`.

import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  rateLimitedResponse,
  requestIdFor,
  clientIpFor,
  headerBag,
} from '@/lib/services';

export const dynamic = 'force-dynamic';

/** Fixed demo grant. Covers one 0.50 USDC submission fee + gas with margin. */
const FAUCET_AMOUNT_USDC = '1.00';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  const svc = services();

  if (!(await svc.generalLimiter.allow({ headers: headerBag(req) }, clientIpFor(req)))) {
    return rateLimitedResponse(rid);
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  if (!ADDRESS_RE.test(address)) {
    return errorResponse(rid, 400, 'INVALID_ADDRESS', 'address must be a 0x-prefixed 20-byte hex string');
  }

  const platformWallet = svc.config.platformWallet;
  if (!platformWallet) {
    return errorResponse(rid, 503, 'NO_PLATFORM_WALLET', 'Platform wallet is not configured; cannot fund demo addresses.');
  }

  try {
    const result = await svc.arc.sendTransfer({
      from: platformWallet,
      to: address,
      amountUsdc: FAUCET_AMOUNT_USDC,
    });
    return successResponse(
      200,
      {
        address,
        amountUsdc: FAUCET_AMOUNT_USDC,
        txHash: result.hash,
        mock: result.mock,
      },
      rid,
    );
  } catch (err) {
    return errorResponse(rid, 500, 'FAUCET_FAILED', err instanceof Error ? err.message : String(err));
  }
}
