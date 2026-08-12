// MODULAR: ERC-8004 agent identities for the three curation agents + A&R.
// Read-only — judges can see on-chain identity IDs even in mock mode.

import type { NextRequest } from "next/server";
import { jsonResponse, requestIdFor, services } from "@/lib/services";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-request-id",
      "Access-Control-Max-Age": "600",
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const svc = services();
  const identities = svc.erc8004.listIdentities();
  return jsonResponse(
    200,
    {
      success: true,
      data: {
        registry: svc.erc8004.registryAddress,
        mock: svc.erc8004.mock,
        agents: identities,
      },
    },
    requestIdFor(req),
  );
}
