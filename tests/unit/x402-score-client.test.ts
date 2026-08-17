// MODULAR: verifies the paid scoring latency metric excludes the wallet
// signature wait. The vitals p50/p95 must measure search, not human
// approval speed — a slow signature must not inflate the headline metric
// (a supervisor hesitating over the wallet prompt is UX time, not search).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchByBriefPaid } from "../../src/lib/x402-score-client";
import { X402_SCHEME, X402_NETWORK, X402_ASSET } from "../../src/lib/x402";

const OFFER = {
  resourceUrl: "/api/x402/score",
  scheme: X402_SCHEME,
  network: X402_NETWORK,
  asset: X402_ASSET,
  payTo: ("0x" + "a".repeat(40)) as `0x${string}`,
  amount: "50000",
  validUntil: 4_102_444_800,
  puid: "puid-test-1",
};

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function scoredData(overrides: Record<string, unknown> = {}) {
  return {
    rows: [],
    total: 0,
    limit: 20,
    offset: 0,
    catalog: { mode: "empty", demo_result_count: 0, live_result_count: 0 },
    payment: {
      puid: "p1",
      amountUsdc: "0.05",
      payTo: OFFER.payTo,
      payer: OFFER.payTo,
      txHash: null,
      mock: true,
      resource: "/api/x402/score",
    },
    ...overrides,
  };
}

describe("searchByBriefPaid latency", () => {
  it("excludes the wallet signature wait from searchLatencyMs", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(402, {}, { "PAYMENT-REQUIRED": b64(OFFER) }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: scoredData() }));

    // Simulate a human taking 150ms to approve the wallet signature.
    const signTypedDataAsync = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return ("0x" + "1".repeat(64)) as `0x${string}`;
    });

    const wallClockStart = performance.now();
    const outcome = await searchByBriefPaid({
      brief: "night drive",
      limit: 20,
      chainId: 5042002,
      signTypedDataAsync: signTypedDataAsync as never,
    });
    const wallClockMs = performance.now() - wallClockStart;

    // The reported latency stays well under the 150ms signature wait, while
    // the wall clock (correctly) still includes it.
    expect(outcome.searchLatencyMs).toBeLessThan(100);
    expect(wallClockMs).toBeGreaterThanOrEqual(150);
  });

  it("returns the scored response and payment receipt", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(402, {}, { "PAYMENT-REQUIRED": b64(OFFER) }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          data: scoredData({ rows: [{ submission_id: "v1" }], total: 1 }),
        }),
      );

    const signTypedDataAsync = vi.fn(
      async () => ("0x" + "2".repeat(64)) as `0x${string}`,
    );

    const outcome = await searchByBriefPaid({
      brief: "x",
      limit: 20,
      chainId: 5042002,
      signTypedDataAsync: signTypedDataAsync as never,
    });

    expect(outcome.response.rows).toHaveLength(1);
    expect(outcome.response.payment.puid).toBe("p1");
    expect(signTypedDataAsync).toHaveBeenCalledTimes(1);
  });
});
