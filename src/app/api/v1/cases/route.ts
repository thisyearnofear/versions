// MODULAR: Placement Case API — the persistent work object the
// supervisor owns. A case is created when a brief is pro-spected in
// Discover (or the Workspace board), survives sessions, and exposes
// the agent plan + the ONE human decision it is waiting on.

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  services,
  successResponse,
  errorResponse,
  requestIdFor,
  parsePositiveIntParam,
} from "@/lib/services";
import { resolveSupervisorIdentity } from "@/lib/supervisor-identity";

export const dynamic = "force-dynamic";

const OpenCaseSchema = z.object({
  briefText: z.string().min(3).max(500),
  rankedCount: z.number().int().nonnegative().optional(),
  pendingDecision: z.string().nullable().optional(),
  candidateTitles: z.array(z.string()).max(5).optional(),
});

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to view your cases.");
  }
  const limit = parsePositiveIntParam(new URL(req.url).searchParams.get("limit"), 20, 50);
  const [rows, open] = await Promise.all([
    services().cases.listCases(identity.wallet, { limit }),
    services().cases.countOpen(identity.wallet),
  ]);
  return successResponse(200, { rows, open }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to open a case.");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsed = OpenCaseSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      "INVALID_CASE",
      parsed.error.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join("; "),
    );
  }
  try {
    const row = await services().cases.openCase({
      supervisorWallet: identity.wallet,
      briefText: parsed.data.briefText,
      rankedCount: parsed.data.rankedCount,
      pendingDecision: parsed.data.pendingDecision,
      candidateTitles: parsed.data.candidateTitles,
    });
    return successResponse(200, { row }, requestId);
  } catch (err) {
    return errorResponse(requestId, 500, "INTERNAL", (err as Error).message);
  }
}