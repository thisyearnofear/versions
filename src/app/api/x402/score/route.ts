// MODULAR: x402-gated agent scoring for brief → ranked takes.
// Guests keep free GET /api/v1/discover/brief. Signed-in supervisors
// optionally pay Market agent $0.05 USDC (x402) to run the scoring
// primitive — AI work as a micropayment, not just tips.
//
// Two-shot (same as /api/x402/tip):
//   1. POST without PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED
//   2. Client signs EIP-712 Offer, retries with PAYMENT-SIGNATURE
//   3. Server verifies, queues settlement to Market agent, returns matches

import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { services, requestIdFor, jsonResponse, errorResponse, parsePositiveIntParam } from "@/lib/services";
import { db } from "@/lib/db";
import { x402Proofs } from "@/lib/schema";
import { emit } from "@/lib/event-bus";
import { log } from "@/lib/logger";
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
} from "@/lib/x402";
import { SCORE_FEE_USDC, SCORE_RESOURCE } from "@/lib/x402-score";

export const dynamic = "force-dynamic";

export { SCORE_FEE_USDC, SCORE_RESOURCE };

const CORS_EXPOSE = "PAYMENT-REQUIRED, PAYMENT-SIGNATURE";
const CORS_BASE = { "Access-Control-Allow-Origin": "*", Vary: "Origin" };

export function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_BASE,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-request-id, PAYMENT-SIGNATURE",
      "Access-Control-Expose-Headers": CORS_EXPOSE,
      "Access-Control-Max-Age": "600",
      "x-request-id": requestIdFor(req),
    },
  });
}

interface ScoreBody {
  brief: string;
  limit?: number;
  offset?: number;
}

function parseBody(raw: unknown): ScoreBody | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.brief !== "string") return null;
  return {
    brief: r.brief,
    limit: typeof r.limit === "number" ? r.limit : undefined,
    offset: typeof r.offset === "number" ? r.offset : undefined,
  };
}

async function chainIdNumber(): Promise<number> {
  const info = await services().arc.getInfo();
  if (info.chainId) return Number(BigInt(info.chainId));
  return 5042002; // Arc testnet fallback
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    const raw = await req.json().catch(() => null);
    const body = parseBody(raw);
    if (!body) {
      return errorResponse(rid, 400, "INVALID_BODY", "brief is required");
    }
    const brief = body.brief.trim();
    if (brief.length < 3 || brief.length > 500) {
      return errorResponse(rid, 400, "INVALID_BRIEF", "brief must be 3-500 characters");
    }

    const svc = services();
    // Pay the Market agent — the agent that synthesizes placement fit.
    const payTo =
      (svc.config.agentWallets[2] as `0x${string}` | undefined) ||
      (svc.config.platformWallet as `0x${string}` | null);
    if (!payTo) {
      return errorResponse(rid, 503, "NO_PAYEE", "No agent wallet configured for scoring fees.");
    }

    const proofHeader = req.headers.get("PAYMENT-SIGNATURE");
    const chainId = await chainIdNumber();
    const domain = buildDomain(chainId);

    // ── Shot 1: challenge ──────────────────────────────
    if (!proofHeader) {
      const puid = randomUUID();
      const amount = parseAmountToMicroUsdc(SCORE_FEE_USDC).toString();
      const offer: X402Offer = {
        resourceUrl: SCORE_RESOURCE,
        scheme: X402_SCHEME,
        network: X402_NETWORK,
        asset: X402_ASSET,
        payTo,
        amount,
        validUntil: Math.floor(Date.now() / 1000) + 300,
        puid,
      };
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "PAYMENT_REQUIRED",
            message: `Pay ${SCORE_FEE_USDC} USDC to run 3-agent scoring`,
            amountUsdc: SCORE_FEE_USDC,
            payTo,
          },
        }),
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            ...CORS_BASE,
            "Access-Control-Expose-Headers": CORS_EXPOSE,
            "PAYMENT-REQUIRED": encodeHeader(offer),
            "x-request-id": rid,
            "x-x402-version": X402_VERSION,
          },
        },
      );
    }

    // ── Shot 2: verify + score ─────────────────────────
    const submitted = decodeHeader<{
      scheme: string;
      signature: `0x${string}`;
      offer: X402Offer;
    }>(proofHeader);
    if (!submitted?.offer || !submitted.signature) {
      return errorResponse(rid, 400, "INVALID_PROOF", "PAYMENT-SIGNATURE must include offer + signature");
    }

    const expectedOffer: X402Offer = {
      resourceUrl: SCORE_RESOURCE,
      scheme: X402_SCHEME,
      network: X402_NETWORK,
      asset: X402_ASSET,
      payTo,
      amount: parseAmountToMicroUsdc(SCORE_FEE_USDC).toString(),
      validUntil: submitted.offer.validUntil,
      puid: submitted.offer.puid,
    };
    if (!offerMatches({ expected: expectedOffer, submitted: submitted.offer })) {
      return errorResponse(rid, 400, "OFFER_MISMATCH", "signed offer does not match score challenge");
    }
    if (submitted.offer.validUntil < Math.floor(Date.now() / 1000)) {
      return errorResponse(rid, 400, "CHALLENGE_EXPIRED", "score challenge expired; retry");
    }

    const [existing] = await db
      .select()
      .from(x402Proofs)
      .where(eq(x402Proofs.puid, submitted.offer.puid))
      .limit(1);
    if (existing) {
      return errorResponse(rid, 409, "DUPLICATE_PROOF", "this puid has already been used");
    }

    let payer: `0x${string}`;
    try {
      payer = await verifyProof({
        domain,
        offer: submitted.offer,
        signature: submitted.signature,
      });
    } catch (err) {
      return errorResponse(rid, 401, "INVALID_SIGNATURE", (err as Error).message);
    }

    const proofId = randomUUID();
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
      tipperWallet: payer,
      artistWallet: payTo.toLowerCase(),
      message: `agent-score:${brief.slice(0, 80)}`,
      signature: submitted.signature,
      txHash: null,
      status: "verified",
      createdAt: new Date(),
      settledAt: null,
    });

    // Batch settle to Market agent (same tip settler path).
    const settled = await svc.tips.settleQueuedFor(payTo.toLowerCase());

    emit("tip-received", {
      type: "verified",
      puid: submitted.offer.puid,
      tipperWallet: payer,
      artistWallet: payTo,
      amountMicroUsdc: submitted.offer.amount,
      txHash: settled.hash,
      mock: settled.mock,
      timestamp: new Date().toISOString(),
    });

    emit("economy-event", {
      kind: "tip",
      settlementId: settled.hash ?? submitted.offer.puid,
      fromWallet: payer,
      toWallet: payTo,
      amountUsdc: SCORE_FEE_USDC,
      txHash: settled.hash,
      mock: settled.mock,
      timestamp: new Date().toISOString(),
    });

    const limit = parsePositiveIntParam(String(body.limit ?? 20), 20, 50);
    const offset = parsePositiveIntParam(String(body.offset ?? 0), 0);
    const result = await svc.feed.searchByBrief({ brief, limit, offset });

    log.info("x402 agent score settled", {
      rid,
      puid: submitted.offer.puid,
      payer,
      payTo,
      mock: settled.mock,
      matches: result.total,
    });

    return jsonResponse(
      200,
      {
        success: true,
        data: {
          ...result,
          payment: {
            puid: submitted.offer.puid,
            amountUsdc: SCORE_FEE_USDC,
            payTo,
            payer,
            txHash: settled.hash,
            mock: settled.mock,
            resource: SCORE_RESOURCE,
          },
        },
      },
      rid,
      {
        ...CORS_BASE,
        "Access-Control-Expose-Headers": CORS_EXPOSE,
      },
    );
  } catch (err) {
    return errorResponse(rid, 500, "INTERNAL", (err as Error).message);
  }
}
