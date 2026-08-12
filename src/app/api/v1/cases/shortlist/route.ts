// MODULAR: attach a shortlist choice (a take the supervisor kept)
// to the supervisor's current open placement case. Keeps the case's
// evidence + activity trail truthful as the supervisor shortlists.

import { NextRequest } from "next/server";
import { z } from "zod";
import { services, successResponse, errorResponse, requestIdFor } from "@/lib/services";
import { resolveSupervisorIdentity } from "@/lib/supervisor-identity";

export const dynamic = "force-dynamic";

const AddShortlistSchema = z.object({
  submissionId: z.string().min(1),
  fitScore: z.number().optional(),
  rank: z.number().int().nonnegative().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to shortlist a take.");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsed = AddShortlistSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_SHORTLIST", "submissionId is required.");
  }
  try {
    const row = await services().cases.addShortlist({
      supervisorWallet: identity.wallet,
      submissionId: parsed.data.submissionId,
      fitScore: parsed.data.fitScore,
      rank: parsed.data.rank,
    });
    return successResponse(200, { row }, requestId);
  } catch (err) {
    return errorResponse(requestId, 500, "INTERNAL", (err as Error).message);
  }
}