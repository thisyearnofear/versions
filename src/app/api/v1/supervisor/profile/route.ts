import { NextRequest } from "next/server";
import { services, successResponse, errorResponse, requestIdFor } from "@/lib/services";
import { resolveSupervisorIdentity } from "@/lib/supervisor-identity";
import { SupervisorProfileUpdateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to view your supervisor profile.");
  }

  const profile = await services().supervisor.getProfile(identity.wallet);
  if (!profile) {
    return successResponse(200, { profile: null }, requestId);
  }
  return successResponse(200, { profile }, requestId);
}

export async function PUT(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to update your supervisor profile.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = SupervisorProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_PROFILE", parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '));
  }

  const profile = await services().supervisor.upsertProfile({
    wallet: identity.wallet,
    email: parsed.data.email,
    name: parsed.data.name,
    company: parsed.data.company,
    role: parsed.data.role,
  });

  return successResponse(200, { profile }, requestId);
}
