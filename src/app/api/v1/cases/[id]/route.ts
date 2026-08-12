// MODULAR: single placement case detail (with its durable activity
// trail) + the decision boundary — the mechanism for clearing the ONE
// pending human judgement and advancing the case (e.g. to rights_review).

import { NextRequest } from "next/server";
import { z } from "zod";
import { services, successResponse, errorResponse, requestIdFor } from "@/lib/services";
import { resolveSupervisorIdentity } from "@/lib/supervisor-identity";

export const dynamic = "force-dynamic";

const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record_creative_decision"), note: z.string().nullable().optional() }),
  z.object({ type: z.literal("start_rights_review"), licenseId: z.string().nullable().optional() }),
  z.object({ type: z.literal("mark_settlement_ready") }),
  z.object({ type: z.literal("record_settlement") }),
]);

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
  const parsed = CommandSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_COMMAND", "Invalid case command.");
  }
  // Server-owned transitions: the service decides whether the command is legal
  // from the current state. The client cannot set arbitrary status strings.
  const result = await services().cases.executeCommand(
    identity.wallet,
    id,
    parsed.data as never,
  );
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "NOT_OWNED" ? 403 : 409;
    return errorResponse(requestId, status, result.code, result.message);
  }
  return successResponse(200, { row: result.row }, requestId);
}