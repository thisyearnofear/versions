// MODULAR: License creation + listing. A supervisor turns a matched take
// into a real license record (take + brief + usage + fee) — the "outcome"
// the thesis sells. Settlement happens separately via POST /:id/pay.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor, parsePositiveIntParam } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { LicenseCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to license a take.');
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = LicenseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_LICENSE',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const license = await services().supervisor.createLicense({
    supervisorWallet: identity.wallet,
    submissionId: parsed.data.submissionId,
    briefHash: parsed.data.briefHash,
    briefText: parsed.data.briefText,
    usageType: parsed.data.usageType,
  });
  if (!license) {
    return errorResponse(requestId, 404, 'VERSION_NOT_FOUND', 'No published take with that id.');
  }
  return successResponse(200, { license }, requestId);
}

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to view your licenses.');
  }
  const { searchParams } = new URL(req.url);
  const limit = parsePositiveIntParam(searchParams.get('limit'), 50, 100);
  const offset = parsePositiveIntParam(searchParams.get('offset'), 0);

  const [rows, total] = await Promise.all([
    services().supervisor.listLicenses(identity.wallet, { limit, offset }),
    services().supervisor.countLicenses(identity.wallet),
  ]);
  return successResponse(200, { rows, total }, requestId);
}