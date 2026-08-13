// MODULAR: License receipt + ERC-8183 settlement.
//   GET  → the license receipt (status, fee, job id, tx, arcscan-able hash).
//   POST → settle: run Open→Funded→Submitted→Completed on ERC-8183, then
//          attribute USDC to the artist (platform-brokered). Mock-first.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { emit } from '@/lib/event-bus';
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

  const existing = await svc.supervisor.getLicense(id, ida.identity!.wallet);
  if (!existing) return errorResponse(requestId, 404, 'NOT_FOUND', 'License not found.');
  if (existing.status === 'paid') {
    await svc.cases.reconcileLicenseOutcome(ida.identity!.wallet, id);
    return successResponse(200, { license: existing }, requestId);
  }

  // Claim the pending row before touching ERC-8183 or USDC. The conditional
  // update makes concurrent clicks idempotent: only one request can move a
  // license from pending_payment to settling.
  const claim = await svc.supervisor.beginLicenseSettlement(id, ida.identity!.wallet);
  if (!claim) {
    const current = await svc.supervisor.getLicense(id, ida.identity!.wallet);
    if (current?.status === 'paid') {
      await svc.cases.reconcileLicenseOutcome(ida.identity!.wallet, id);
      return successResponse(200, { license: current }, requestId);
    }
    return errorResponse(requestId, 409, 'SETTLEMENT_IN_PROGRESS', 'This license is already being settled.');
  }
  const before = claim.license;

  try {
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
  //    If live Arc fails (e.g. unfunded wallet), fall back to mock so the
  //    demo loop stays intact — still returns a job receipt + mock flag.
  let settledJob;
  try {
    settledJob = await svc.erc8183.settleLicenseJob({
      clientAddress: client,
      providerAddress: provider,
      evaluatorAddress: client,
      description,
      budgetUsdc: before.fee_usdc,
      deliverableHash,
      jobId: before.job_id,
    });
  } catch (err) {
    const mockAdapter = (await import('@/adapters/erc8183')).createErc8183Adapter({});
    settledJob = await mockAdapter.settleLicenseJob({
      clientAddress: client,
      providerAddress: provider,
      evaluatorAddress: client,
      description,
      budgetUsdc: before.fee_usdc,
      deliverableHash,
      jobId: before.job_id,
    });
    settledJob = { ...settledJob, mock: true };
    void err;
  }

  // 2. Attribute USDC to the take's artist (platform → artist). This is the
  //    royalty leg; the 8183 job is the escrowed license job receipt.
  const to = before.artist_wallet ?? `0x${'0'.repeat(40)}`;
  const tx = await svc.arc.sendTransfer({ from: '', to, amountUsdc: before.fee_usdc });

  const license = await svc.supervisor.markLicensePaid(id, ida.identity!.wallet, claim.leaseId, {
    txHash: tx.hash,
    mock: tx.mock || settledJob.mock,
    jobId: settledJob.jobId,
    jobStatus: settledJob.status,
    deliverableHash: settledJob.deliverableHash,
    jobCreateTxHash: settledJob.createTxHash ?? before.job_create_tx_hash,
    jobCompleteTxHash: settledJob.completeTxHash,
  });
  if (!license) {
    return errorResponse(
      requestId,
      409,
      'SETTLEMENT_CLAIM_LOST',
      'Settlement completed externally but its lease is no longer active. Reconciliation is required.',
    );
  }

  // Persist the terminal projection before returning success. The operation is
  // idempotent, and a paid-license retry invokes it again if this request is
  // interrupted after settlement.
  await svc.cases.reconcileLicenseOutcome(ida.identity!.wallet, id);

  // Case status is derived from this authoritative paid license during reads;
  // no detached side effect can leave a case falsely pending or settled.

  const settlementTimestamp = new Date().toISOString();
  // Canonical receipt stream: the sync license and artist payout settled.
  emit('settlement-event', {
    type: 'settled',
    source: 'license',
    settlementId: id,
    toWallet: before.artist_wallet ?? undefined,
    artistWallet: before.artist_wallet ?? undefined,
    amountUsdc: before.fee_usdc,
    txHash: tx.hash,
    mock: tx.mock || settledJob.mock,
    submissionId: before.submission_id,
    title: before.title,
    artistName: before.artist_name,
    jobId: settledJob.jobId,
    timestamp: settlementTimestamp,
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
  } catch (err) {
    // The external executor may already have accepted work. Leave the
    // owner-bound claim in `settling` for explicit reconciliation rather than
    // reopening a license that could be paid twice.
    throw err;
  }
}
