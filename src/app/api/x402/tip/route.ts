// MODULAR: x402 nanopayment tip endpoint.
//
// DRY: every nanocent a listener sends to an artist flows through
//      here. The route is the single point that builds challenges,
//      verifies proofs, persists idempotency, and submits to Gateway.
//
// CLEAN: two-shot protocol (per the x402 spec):
//        1. POST without PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED
//           challenge header (base64 JSON with the EIP-712 Offer).
//        2. Client signs the offer with wagmi's useSignTypedData,
//           retries with PAYMENT-SIGNATURE header (base64 JSON).
//        3. Server verifies, persists to x402_proofs, submits to
//           Gateway, emits tip-received, returns 200.
//
// PERFORMANT: the challenge is built once per request; the verify
//             is O(1) via viem.verifyTypedData. The DB write is a
//             single insert with a unique constraint on puid so
//             replays are rejected at the DB layer.

import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { services, requestIdFor, corsPreflight, jsonResponse, errorResponse } from '@/lib/services';
import { db } from '@/lib/db';
import { x402Proofs } from '@/lib/schema';
import { emit } from '@/lib/event-bus';
import { log } from '@/lib/logger';
import {
  X402_VERSION,
  X402_SCHEME,
  X402_NETWORK,
  X402_ASSET,
  buildDomain,
  encodeHeader,
  decodeHeader,
  verifyProof,
  offerMatches,
  parseAmountToMicroUsdc,
  type X402Offer,
} from '@/lib/x402';

export const dynamic = 'force-dynamic';

// CORS: expose the custom x402 headers so the client can read them.
// Browsers hide non-simple headers from JS by default.
const CORS_EXPOSE = 'PAYMENT-REQUIRED, PAYMENT-SIGNATURE';
const CORS_BASE = { 'Access-Control-Allow-Origin': '*', Vary: 'Origin' };
const corsExposeHeaders = { ...CORS_BASE, 'Access-Control-Expose-Headers': CORS_EXPOSE };

export function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_BASE,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-request-id, PAYMENT-SIGNATURE',
      'Access-Control-Expose-Headers': CORS_EXPOSE,
      'Access-Control-Max-Age': '600',
      'x-request-id': requestIdFor(req),
    },
  });
}

interface TipRequestBody {
  artistWallet: string;
  amountUsdc: string; // decimal string, e.g. "0.0001" (100 leptons)
  message?: string;
}

function parseBody(raw: unknown): TipRequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.artistWallet !== 'string') return null;
  if (typeof r.amountUsdc !== 'string') return null;
  if (r.message !== undefined && typeof r.message !== 'string') return null;
  return {
    artistWallet: r.artistWallet,
    amountUsdc: r.amountUsdc,
    message: typeof r.message === 'string' ? r.message.slice(0, 200) : undefined,
  };
}

/**
 * Build a challenge offer for the given tip request. The challenge
 * is what the client signs with EIP-712; the server validates that
 * the submitted proof's offer matches this one exactly (same
 * amount, payTo, puid) so the proof can't be redirected to a
 * different recipient or amount.
 */
async function buildChallenge(args: {
  resourceUrl: string;
  payTo: string;
  amountUsdc: string;
  puid: string;
  chainId: number;
}): Promise<X402Offer> {
  // MODULAR: convert the decimal amount to micro-units once so
  // client and server agree on the exact uint256 value. parseAmountToMicroUsdc
  // throws on bad input, which the caller catches and returns 400.
  const amount = parseAmountToMicroUsdc(args.amountUsdc).toString();
  return {
    resourceUrl: args.resourceUrl,
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    asset: X402_ASSET,
    payTo: args.payTo as `0x${string}`,
    amount,
    // MODULAR: 5-minute validity window. Long enough that a human
    // can sign in their wallet, short enough that replays across
    // sessions are blocked.
    validUntil: Math.floor(Date.now() / 1000) + 300,
    puid: args.puid,
  };
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    // MODULAR: the artist wallet comes from the body for the
    // challenge (server is the payTo). On the retry, the signature
    // is what proves the tipper authorized this exact offer.
    const body = parseBody(await req.json().catch(() => null));
    if (!body) {
      return errorResponse(rid, 400, 'INVALID_BODY', 'expected {artistWallet, amountUsdc, message?}');
    }
    let amountMicro: bigint;
    try {
      amountMicro = parseAmountToMicroUsdc(body.amountUsdc);
    } catch (err) {
      return errorResponse(rid, 400, 'INVALID_AMOUNT', (err as Error).message);
    }
    if (amountMicro <= 0n) {
      return errorResponse(rid, 400, 'INVALID_AMOUNT', 'amount must be positive');
    }
    // MODULAR: cap per-tip at 1 USDC so a fat-finger can't drain
    // a wallet. Larger flows should use a different surface.
    if (amountMicro > 1_000_000n) {
      return errorResponse(rid, 400, 'AMOUNT_TOO_LARGE', 'per-tip cap is 1 USDC; use the submission flow for larger amounts');
    }

    const gateway = services().gateway;
    const gatewayInfo = await gateway.getInfo();
    // MODULAR: use the actual Arc chainId (or 1 fallback if
    // getInfo returned null in a fully offline env) so the
    // EIP-712 domain matches the chain the wallet is connected to.
    const arcInfo = await services().arc.getInfo();
    const chainId = arcInfo.chainId ? Number(BigInt(arcInfo.chainId)) : 1;
    const domain = buildDomain(chainId);

    // MODULAR: the platform wallet receives the tip on behalf of
    // the artist and credits the artist in the batch settlement.
    // In mock mode there is no platform wallet, so the artist
    // wallet IS the payTo — the demo just credits the artist directly.
    const platformWallet = services().config.platformWallet;
    const payTo = (platformWallet ?? body.artistWallet) as `0x${string}`;

    // First call (no payment proof): issue a 402 challenge.
    const paymentHeader = req.headers.get('PAYMENT-SIGNATURE');
    if (!paymentHeader) {
      const puid = randomUUID();
      const challenge = await buildChallenge({
        resourceUrl: new URL(req.url).pathname,
        payTo,
        amountUsdc: body.amountUsdc,
        puid,
        chainId,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'PAYMENT_REQUIRED',
            message: `Tip ${body.artistWallet} ${body.amountUsdc} USDC to settle this tip.`,
            details: { challenge },
          },
        }),
        {
          status: 402,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'x-request-id': rid,
            ...corsExposeHeaders,
            'PAYMENT-REQUIRED': encodeHeader(challenge),
            'PAYMENT-SIGNATURE': encodeHeader({ scheme: X402_SCHEME, version: X402_VERSION }),
          },
        },
      );
    }

    // Second call: decode the signed proof and verify it.
    const submitted = decodeHeader<{ scheme: string; signature: `0x${string}`; offer: X402Offer }>(paymentHeader);
    if (!submitted || !submitted.signature || !submitted.offer) {
      return errorResponse(rid, 400, 'INVALID_PAYMENT_SIGNATURE', 'PAYMENT-SIGNATURE must encode {scheme, signature, offer}');
    }
    // MODULAR: rebuild the expected challenge from the same body
    // and compare. The offer's amount, payTo, and puid must all
    // match the server's expectations exactly.
    const expectedOffer = await buildChallenge({
      resourceUrl: new URL(req.url).pathname,
      payTo,
      amountUsdc: body.amountUsdc,
      puid: submitted.offer.puid,
      chainId,
    });
    if (!offerMatches({ expected: expectedOffer, submitted: submitted.offer })) {
      return errorResponse(rid, 400, 'OFFER_MISMATCH', 'signed offer does not match the server-issued challenge');
    }
    if (submitted.offer.validUntil < Math.floor(Date.now() / 1000)) {
      return errorResponse(rid, 400, 'CHALLENGE_EXPIRED', 'signed offer has expired; request a new 402');
    }

    // MODULAR: persist the proof BEFORE verifying the signature.
    // The unique constraint on puid gives us free replay
    // protection: a duplicate insert returns the existing row
    // and we reject with 409.
    const [existing] = await db
      .select()
      .from(x402Proofs)
      .where(eq(x402Proofs.puid, submitted.offer.puid))
      .limit(1);
    if (existing) {
      return errorResponse(rid, 409, 'DUPLICATE_PROOF', 'this puid has already been settled', { puid: existing.puid });
    }

    // MODULAR: the tipper wallet is the recovered signer from
    // the EIP-712 signature. We can't trust a client-claimed
    // "from" field — only the recovered address.
    let tipperWallet: `0x${string}`;
    try {
      tipperWallet = await verifyProof({ domain, offer: submitted.offer, signature: submitted.signature });
    } catch (err) {
      return errorResponse(rid, 401, 'INVALID_SIGNATURE', (err as Error).message);
    }

    // MODULAR: write the proof row first (idempotency), then
    // submit to Gateway. If Gateway fails, we mark the row
    // 'failed' so the audit trail is honest.
    const proofId = randomUUID();
    try {
      await db.insert(x402Proofs).values({
        id: proofId,
        puid: submitted.offer.puid,
        resourceUrl: submitted.offer.resourceUrl,
        scheme: submitted.offer.scheme,
        network: submitted.offer.network,
        asset: submitted.offer.asset,
        payTo: submitted.offer.payTo,
        amountMicroUsdc: submitted.offer.amount,
        validUntil: new Date(submitted.offer.validUntil * 1000),
        tipperWallet,
        artistWallet: body.artistWallet,
        message: body.message ?? null,
        signature: submitted.signature,
        txHash: null,
        status: 'verified',
        createdAt: new Date(),
        settledAt: null,
      });
    } catch (err) {
      // MODULAR: unique-constraint race. Another request won
      // the insert. Return 409 so the client knows.
      return errorResponse(rid, 409, 'DUPLICATE_PROOF', 'this puid has already been settled', { err: (err as Error).message });
    }

    let result: Awaited<ReturnType<typeof gateway.submitTip>>;
    try {
      result = await gateway.submitTip({
        from: tipperWallet,
        to: body.artistWallet,
        amountUsdc: body.amountUsdc,
        puid: submitted.offer.puid,
        message: body.message,
      });
    } catch (err) {
      await db
        .update(x402Proofs)
        .set({ status: 'failed' })
        .where(eq(x402Proofs.id, proofId));
      return errorResponse(rid, 502, 'GATEWAY_FAILED', (err as Error).message);
    }

    await db
      .update(x402Proofs)
      .set({ status: 'settled', txHash: result.hash, settledAt: new Date() })
      .where(eq(x402Proofs.id, proofId));

    // MODULAR: emit on the bus so artist dashboards and the SSE
    // stream can react in real time.
    emit('tip-received', {
      type: 'verified',
      puid: submitted.offer.puid,
      tipperWallet,
      artistWallet: body.artistWallet,
      amountMicroUsdc: submitted.offer.amount,
      txHash: result.hash,
      mock: result.mock,
      timestamp: new Date().toISOString(),
    });

    log.info('tip settled', {
      rid,
      puid: submitted.offer.puid,
      amount: body.amountUsdc,
      from: tipperWallet,
      to: body.artistWallet,
      mock: result.mock,
      network: gatewayInfo.network,
    });

    return jsonResponse(200, {
      success: true,
      data: {
        ok: true,
        hash: result.hash,
        puid: submitted.offer.puid,
        status: result.status,
        mock: result.mock,
        amountMicroUsdc: submitted.offer.amount,
        amountUsdc: body.amountUsdc,
        tipperWallet,
        artistWallet: body.artistWallet,
        settledAt: result.batchedAt,
      },
    }, rid, corsExposeHeaders);
  } catch (err) {
    log.error('tip route error', { rid, err: (err as Error).message });
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
