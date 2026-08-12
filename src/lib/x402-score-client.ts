"use client";

// MODULAR: client-side x402 two-shot for agent scoring.
// Free search stays on GET /api/v1/discover/brief. This helper pays
// Market agent $0.05 USDC then returns ranked matches + payment receipt.

import { getAddress } from "viem";
import {
  X402_OFFER_TYPES,
  X402_SCHEME,
  X402_VERSION,
  type X402Offer,
} from "@/lib/x402";
import { SCORE_FEE_USDC } from "@/lib/x402-score";
import type { BriefSearchResponse } from "@/lib/types";

export { SCORE_FEE_USDC };

export interface ScorePaymentReceipt {
  puid: string;
  amountUsdc: string;
  payTo: string;
  payer: string;
  txHash: string | null;
  mock: boolean;
  resource: string;
}

export type PaidBriefSearchResponse = BriefSearchResponse & {
  payment: ScorePaymentReceipt;
};

function decodeBase64<T>(b64: string): T {
  const json =
    typeof window === "undefined"
      ? Buffer.from(b64, "base64").toString("utf8")
      : atob(b64);
  return JSON.parse(json) as T;
}

export async function searchByBriefPaid(args: {
  brief: string;
  limit?: number;
  chainId: number;
  signTypedDataAsync: (params: {
    domain: { name: string; version: string; chainId: number };
    types: typeof X402_OFFER_TYPES;
    primaryType: "Offer";
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
}): Promise<PaidBriefSearchResponse> {
  const body = JSON.stringify({
    brief: args.brief,
    limit: args.limit ?? 20,
  });

  const first = await fetch("/api/x402/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const challengeHeader = first.headers.get("PAYMENT-REQUIRED");
  if (first.status !== 402 || !challengeHeader) {
    const json = (await first.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(json?.error?.message ?? `expected 402, got ${first.status}`);
  }

  const offer = decodeBase64<X402Offer>(challengeHeader);
  const signature = await args.signTypedDataAsync({
    domain: {
      name: "VERSIONS x402",
      version: X402_VERSION,
      chainId: args.chainId,
    },
    types: X402_OFFER_TYPES,
    primaryType: "Offer",
    message: {
      ...offer,
      amount: BigInt(offer.amount),
      validUntil: BigInt(offer.validUntil),
      payTo: getAddress(offer.payTo),
    },
  });

  const proof = { scheme: X402_SCHEME, signature, offer };
  const proofB64 =
    typeof window === "undefined"
      ? Buffer.from(JSON.stringify(proof), "utf8").toString("base64")
      : btoa(JSON.stringify(proof));

  const second = await fetch("/api/x402/score", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": proofB64,
    },
    body,
  });
  const json = (await second.json().catch(() => ({}))) as {
    success?: boolean;
    data?: PaidBriefSearchResponse;
    error?: { message?: string };
  };
  if (!second.ok || !json.success || !json.data) {
    throw new Error(json.error?.message ?? `score failed (${second.status})`);
  }
  return json.data;
}
