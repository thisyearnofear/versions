import { NextRequest } from "next/server";
import { services, successResponse, errorResponse, requestIdFor, parsePositiveIntParam } from "@/lib/services";
import { resolveAuthenticatedSupervisorIdentity } from "@/lib/supervisor-identity";
import { LicensingInterestSchema, LicensingInterestUpdateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Sign in to view your shortlist.");
  }

  const { searchParams } = new URL(req.url);
  const limit = parsePositiveIntParam(searchParams.get("limit"), 50, 100);
  const offset = parsePositiveIntParam(searchParams.get("offset"), 0);

  const [rows, total] = await Promise.all([
    services().supervisor.listInterests(identity.wallet, { limit, offset }),
    services().supervisor.countInterests(identity.wallet),
  ]);
  return successResponse(200, { rows, total }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Sign in to shortlist a track.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = LicensingInterestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_INTEREST", parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '));
  }

  const row = await services().supervisor.addInterest({
    supervisorWallet: identity.wallet,
    submissionId: parsed.data.submissionId,
    status: parsed.data.status,
    notes: parsed.data.notes ?? undefined,
  });

  return successResponse(200, { row }, requestId);
}

export async function PATCH(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Sign in to update your shortlist.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = LicensingInterestUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_INTEREST", parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '));
  }

  const updates: Partial<{ status: "interested" | "contacted" | "licensed" | "passed"; notes: string }> = {};
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? undefined;

  const row = await services().supervisor.updateInterest(parsed.data.id, identity.wallet, updates);
  if (!row) {
    return errorResponse(requestId, 404, "NOT_FOUND", "Interest not found.");
  }
  return successResponse(200, { row }, requestId);
}
