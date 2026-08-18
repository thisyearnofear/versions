// MODULAR: License creation + listing. A supervisor turns a matched take
// into a real license record (take + brief + usage + fee) — the "outcome"
// the thesis sells. Opening a license also opens an ERC-8183 job (Open).
// Settlement happens separately via POST /:id/pay.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor, parsePositiveIntParam } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { LicenseCreateSchema } from '@/lib/validation';
import { licenseDeliverableHash } from '@/adapters/erc8183';

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

  const svc = services();
  const version = await svc.feed.getVersion(parsed.data.submissionId);
  if (!version) {
    return errorResponse(requestId, 404, 'VERSION_NOT_FOUND', 'No published take with that id.');
  }
  if (version.version.catalogSource === 'demo') {
    return errorResponse(
      requestId,
      409,
      'DEMO_CATALOG_ONLY',
      'Guided-demo takes support a non-binding preview only and cannot create a license job or settlement.',
    );
  }
  // MODULAR: pilot pre-clearance gate. Authorized versions are licensable
  // only while their program is active and the version is still
  // artist-approved — a revocation or rejection blocks new licenses at the
  // money gate, not at search time.
  if (version.version.catalogSource === 'authorized') {
    const gate = version.program;
    if (!gate) {
      return errorResponse(
        requestId,
        409,
        'PROGRAM_NOT_FOUND',
        'This version references an authorized-version program that no longer exists.',
      );
    }
    if (gate.program_status !== 'active') {
      return errorResponse(
        requestId,
        409,
        'PROGRAM_NOT_ACTIVE',
        `The authorizing program is ${gate.program_status}; this version is no longer pre-cleared.`,
      );
    }
    if (gate.authorization_status !== 'approved') {
      return errorResponse(
        requestId,
        409,
        'VERSION_NOT_APPROVED',
        'The artist has not approved this version for licensing.',
      );
    }
  }
  const license = await svc.supervisor.createLicense({
    supervisorWallet: identity.wallet,
    submissionId: parsed.data.submissionId,
    briefHash: parsed.data.briefHash,
    briefText: parsed.data.briefText,
    usageType: parsed.data.usageType,
  });
  if (!license) {
    return errorResponse(requestId, 404, 'VERSION_NOT_FOUND', 'No published take with that id.');
  }

  // Associate this license with a case only through the server-verified
  // brief + shortlist relationship. Await it so a route response never hides
  // a failed lifecycle update; read-time projection remains a repair path for
  // records written before this guard existed.
  await svc.cases.linkLicenseForOutcome(identity.wallet, { licenseId: license.id });

  // MODULAR: open an ERC-8183 job for this license (Open state).
  // Settlement (fund → submit → complete) happens on POST /:id/pay.
  const client = svc.config.platformWallet ?? identity.wallet;
  const provider = svc.config.agentWallets[2] ?? client;
  const deliverableHash = licenseDeliverableHash({
    briefHash: license.brief_hash,
    submissionId: license.submission_id,
    usageType: license.usage_type,
    feeUsdc: license.fee_usdc,
  });
  const description = [
    'VERSIONS sync license',
    `take=${license.submission_id}`,
    `artist=${license.artist_wallet ?? 'unknown'}`,
    `usage=${license.usage_type}`,
    `fee=${license.fee_usdc} USDC`,
    `brief=${license.brief_text.slice(0, 120)}`,
  ].join(' · ');

  try {
    const opened = await svc.erc8183.openLicenseJob({
      clientAddress: client,
      providerAddress: provider,
      evaluatorAddress: client,
      description,
      budgetUsdc: license.fee_usdc,
      deliverableHash,
      jobId: license.job_id,
    });
    const withJob = await svc.supervisor.attachLicenseJob(license.id, identity.wallet, {
      jobId: opened.jobId,
      jobStatus: opened.status,
      deliverableHash,
      jobCreateTxHash: opened.createTxHash,
    });
    return successResponse(200, { license: withJob ?? license }, requestId);
  } catch {
    // Live open failed (unfunded / RPC) — open in mock so the license still
    // carries a job id for the dashboard demo path.
    const { createErc8183Adapter } = await import('@/adapters/erc8183');
    const opened = await createErc8183Adapter({}).openLicenseJob({
      clientAddress: client,
      providerAddress: provider,
      evaluatorAddress: client,
      description,
      budgetUsdc: license.fee_usdc,
      deliverableHash,
      jobId: license.job_id,
    });
    const withJob = await svc.supervisor.attachLicenseJob(license.id, identity.wallet, {
      jobId: opened.jobId,
      jobStatus: opened.status,
      deliverableHash,
      jobCreateTxHash: opened.createTxHash,
    });
    return successResponse(200, { license: withJob ?? license }, requestId);
  }
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
