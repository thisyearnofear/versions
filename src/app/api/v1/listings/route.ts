// MODULAR: Listings — unified marketplace supply.
//   GET  → live catalog (public). Filter by kind. `?mine=1` scopes to the signed-in supplier.
//   POST → create a listing (supplier, blanket ToS).
//
// SAFE: creation is wallet-scoped — a music listing is only creatable against
// a submission the caller actually owns (checked in the service). The route
// never trusts a wallet address from the body.

import { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
  parsePositiveIntParam,
} from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { ListingCreateSchema } from '@/lib/validation';
import type { ListingFailureCode } from '@/services/listings';

export const dynamic = 'force-dynamic';

const STATUS_FOR_FAILURE: Record<ListingFailureCode, number> = {
  AGREEMENT_VERSION_STALE: 409,
  INVALID_TITLE: 400,
  INVALID_TAGS: 400,
  SUBMISSION_REQUIRED: 400,
  SUBMISSION_NOT_FOUND: 404,
  SUBMISSION_NOT_OWNED: 403,
  IMAGES_REQUIRED: 400,
  INVALID_PRICING: 400,
  INVALID_BUDGET: 400,
  LISTING_NOT_FOUND: 404,
};

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind');
  const mine = searchParams.get('mine');
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 100);
  const offset = parsePositiveIntParam(searchParams.get('offset'), 0);

  // Supplier view: `?mine=1` returns only the caller's own listings (any status).
  if (mine === '1' || mine === 'true') {
    const identity = await resolveAuthenticatedSupervisorIdentity();
    if (!identity) {
      return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to view your supply.');
    }
    const rows = await services().listings.listForSupplier(identity.wallet, { limit });
    return successResponse(200, { listings: rows, total: rows.length }, requestId);
  }

  // Public catalog: live supply. Optional kind filter. Paginated.
  const rows = await services().listings.listActive({
    kind: kind === 'music' || kind === 'placement' ? kind : undefined,
    limit,
    offset,
  });
  return successResponse(200, { listings: rows }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to create a listing.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = ListingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_LISTING',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const pricing = parsed.data.pricing
    ? {
        model: parsed.data.pricing.model,
        ...(parsed.data.pricing.flatFeeUsdc != null ? { flatFeeUsdc: parsed.data.pricing.flatFeeUsdc } : {}),
        ...(parsed.data.pricing.cpmUsdc != null ? { cpmUsdc: parsed.data.pricing.cpmUsdc } : {}),
      }
    : null;
  const result = await services().listings.create({
    supplierWallet: identity.wallet,
    kind: parsed.data.kind,
    title: parsed.data.title,
    supplierName: parsed.data.supplierName,
    summary: parsed.data.summary ?? null,
    tags: parsed.data.tags,
    images: parsed.data.images ?? undefined,
    submissionId: parsed.data.submissionId ?? null,
    tier: parsed.data.tier,
    pricing: pricing as never,
    budgetCapUsdc: parsed.data.budgetCapUsdc ?? null,
    agreementVersion: parsed.data.agreementVersion,
  });

  if (!result.ok) {
    return errorResponse(requestId, STATUS_FOR_FAILURE[result.code], result.code, result.message);
  }
  return successResponse(201, { listing: result.listing }, requestId);
}
