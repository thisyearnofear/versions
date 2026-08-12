// MODULAR: License receipt + ERC-8183 settlement.
//   GET  → the license receipt (status, fee, job id, tx, arcscan-able hash).
//   POST → settle: run Open→Funded→Submitted→Completed on ERC-8183, then
//          attribute USDC to the artist (platform-brokered). Mock-first.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { licenseDeliverableHash } from '@/adapters/erc8183';

export const dynamic = 'force-dynamic';

async function identityOr401(requestId: string) {
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return { resp: errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to view a license.') };
  }
  return { identity };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(req);
  const ida = await identityOr401(requestId);
  if (ida.resp) return ida.resp;
  const { id } = await ctx.params;
  const license = await services().supervisor.getLicense(id, ida.identity!.wallet);
  if (!license) return errorResponse(requestId, 404, 'NOT_FOUND', 'License not found.');
  return successResponse(200, { license }, requestId);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFor(req);
  const ida = await identityOr401(requestId);
  if (ida.resp) return ida.resp;
  const { id } = await ctx.params;
  const svc = services();

  const before = await svc.supervisor.getLicense(id, ida.identity!.wallet);
  if (!before) return errorResponse(requestId, 404, 'NOT_FOUND', 'License not found.');
  if (before.status === 'paid') {
    return successResponse(200, { license: before }, requestId);
  }

  const client = svc.config.platformWallet ?? ida.identity!.wallet;
  const provider = svc.config.agentWallets[2] ?? client;
  const deliverableHash =
    (before.deliverable_hash as `0x${string}` | null) ??
    licenseDeliverableHash({
      briefHash: before.brief_hash,
      submissionId: before.submission_id,
      usageType: before.usage_type,
      feeUsdc: before.fee_usdc,
    });
  const description = [
    'VERSIONS sync license',
    `take=${before.submission_id}`,
    `artist=${before.artist_wallet ?? 'unknown'}`,
    `usage=${before.usage_type}`,
    `fee=${before.fee_usdc} USDC`,
  ].join(' · ');

  // 1. ERC-8183 job lifecycle → Completed (escrow to provider / clearing agent).
  const settledJob = await svc.erc8183.settleLicenseJob({
    clientAddress: client,
    providerAddress: provider,
    evaluatorAddress: client,
    description,
    budgetUsdc: before.fee_usdc,
    deliverableHash,
    jobId: before.job_id,
  });

  // 2. Attribute USDC to the take's artist (platform → artist). This is the
  //    royalty leg; the 8183 job is the escrowed license job receipt.
  const to = before.artist_wallet ?? `0x${'0'.repeat(40)}`;
  const tx = await svc.arc.sendTransfer({ from: '', to, amountUsdc: before.fee_usdc });

  const license = await svc.supervisor.markLicensePaid(id, ida.identity!.wallet, {
    txHash: tx.hash,
    mock: tx.mock || settledJob.mock,
    jobId: settledJob.jobId,
    jobStatus: settledJob.status,
    deliverableHash: settledJob.deliverableHash,
    jobCreateTxHash: settledJob.createTxHash ?? before.job_create_tx_hash,
    jobCompleteTxHash: settledJob.completeTxHash,
  });

  return successResponse(
    200,
    {
      license,
      settled: {
        txHash: tx.hash,
        mock: tx.mock || settledJob.mock,
        jobId: settledJob.jobId,
        jobStatus: settledJob.status,
        completeTxHash: settledJob.completeTxHash,
        deliverableHash: settledJob.deliverableHash,
      },
    },
    requestId,
  );
}
