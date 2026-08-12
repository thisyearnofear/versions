// MODULAR: single placement case detail (with its durable activity
// trail) + the decision boundary — the mechanism for clearing the ONE
// pending human judgement and advancing the case (e.g. to rights_review).

import { NextRequest } from "next/server";
import { z } from "zod";
import { services, successResponse, errorResponse, requestIdFor } from "@/lib/services";
import { resolveSupervisorIdentity } from "@/lib/supervisor-identity";

export const dynamic = "force-dynamic";

const DecisionSchema = z.object({
  status: z.string().optional(),
  clearPending: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to view this case.");
  }
  const { id } = await ctx.params;
  const result = await services().cases.getCase(identity.wallet, id);
  if (!result) {
    return errorResponse(requestId, 404, "NOT_FOUND", "Case not found.");
  }
  return successResponse(200, result, requestId);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to update this case.");
  }
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_DECISION", "Invalid decision payload.");
  }
  const row = await services().cases.recordDecision({
    supervisorWallet: identity.wallet,
    caseId: id,
    status: parsed.data.status,
    clearPending: parsed.data.clearPending,
    note: parsed.data.note,
  });
  if (!row) {
    return errorResponse(requestId, 404, "NOT_FOUND", "Case not found.");
  }
  return successResponse(200, { row }, requestId);
}