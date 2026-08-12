import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { resolveWalletIdentity } from "@/lib/wallet-identity";
import { successResponse, errorResponse, corsPreflight, requestIdFor } from "@/lib/services";

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { address } = await ctx.params;
    if (!isAddress(address)) {
      return errorResponse(rid, 400, "INVALID_ADDRESS", "Expected a 0x-prefixed EVM address.");
    }
    const identity = await resolveWalletIdentity(address);
    return successResponse(200, { identity }, rid);
  } catch (err) {
    return errorResponse(rid, 500, "INTERNAL", (err as Error).message);
  }
}
