import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { services, successResponse, errorResponse, requestIdFor, parsePositiveIntParam } from "@/lib/services";
import { BriefTextInputSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const session = await auth();
  const wallet = (session?.user as { walletAddress?: string } | undefined)?.walletAddress;
  if (!wallet) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to view recent searches.");
  }

  const { searchParams } = new URL(req.url);
  const limit = parsePositiveIntParam(searchParams.get("limit"), 20, 100);
  const offset = parsePositiveIntParam(searchParams.get("offset"), 0);
  const search = searchParams.get("search") ?? undefined;

  const [rows, total] = await Promise.all([
    services().supervisor.listRecentSearches(wallet, { limit, offset, search }),
    services().supervisor.countRecentSearches(wallet, { search }),
  ]);
  return successResponse(200, { rows, total }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const session = await auth();
  const wallet = (session?.user as { walletAddress?: string } | undefined)?.walletAddress;
  if (!wallet) {
    return errorResponse(requestId, 401, "UNAUTHORIZED", "Connect your wallet to log a search.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(requestId, 400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = BriefTextInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, 400, "INVALID_BRIEF", parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '));
  }

  const row = await services().supervisor.logSearch({
    supervisorWallet: wallet,
    briefText: parsed.data.briefText,
    filters: parsed.data.filters,
    resultsCount: typeof body.resultsCount === "number" ? body.resultsCount : 0,
  });

  return successResponse(200, { row }, requestId);
}
