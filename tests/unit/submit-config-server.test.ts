// MODULAR: tests for the server-side env-var parser in
// src/lib/submit-config.server.ts. Mirrors the client parser
// suite (tests/unit/use-submit-payment.test.ts) but reads the
// non-NEXT_PUBLIC env var so server processes (cron sweeper,
// API handlers, queued jobs) are exercised under the same
// floor-then-bounds contract.
//
// Both parsers reuse parseSubmitReceiptTimeoutMsFrom in
// src/lib/submit-config.ts — the only thing that differs here
// is the env-var name under test. So the assertion matrix is
// identical (missing / empty / "abc" / "NaN" / "Infinity" /
// "0" / "-1" / MIN-1 / "5000" / MAX+1 / "5000000" / "1e9" /
// "300000" (MAX) / "30000" / fractional floor at MIN /
// fractional floor at MAX). If the parser logic ever drifts
// from the client side, these tests have to drift too — that's
// the point of having two narrow env-binding tests instead of
// one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseServerSubmitReceiptTimeoutMs,
  DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
  MIN_SUBMIT_RECEIPT_TIMEOUT_MS,
  MAX_SUBMIT_RECEIPT_TIMEOUT_MS,
} from "@/lib/submit-config.server";

const ENV_KEY = "SUBMIT_RECEIPT_TIMEOUT_MS";

describe("parseServerSubmitReceiptTimeoutMs", () => {
  // Capture the host shell's value at module load so the
  // afterEach restore step doesn't accidentally clobber an
  // operator who happened to have SUBMIT_RECEIPT_TIMEOUT_MS
  // exported in their environment when running the suite.
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    // Each case starts from a clean slate — a stray env var on
    // the host shell MUST NOT leak between tests.
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  // ► Empty / missing / unparseable → default
  it("returns DEFAULT when env var is missing", () => {
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is the empty string", () => {
    process.env[ENV_KEY] = "";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is non-numeric (\"abc\")", () => {
    process.env[ENV_KEY] = "abc";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is the literal string \"NaN\"", () => {
    process.env[ENV_KEY] = "NaN";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is the literal string \"Infinity\"", () => {
    process.env[ENV_KEY] = "Infinity";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  // ► Below MIN
  it("returns DEFAULT when env var is \"0\" (below MIN)", () => {
    process.env[ENV_KEY] = "0";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is \"-1\" (below MIN)", () => {
    process.env[ENV_KEY] = "-1";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is one millisecond below MIN", () => {
    process.env[ENV_KEY] = String(MIN_SUBMIT_RECEIPT_TIMEOUT_MS - 1);
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  // ► Equality with MIN
  it("accepts MIN exactly (5_000 → 5_000)", () => {
    process.env[ENV_KEY] = "5000";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      MIN_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  // ► Above MAX
  it("returns DEFAULT when env var is one millisecond above MAX", () => {
    process.env[ENV_KEY] = String(MAX_SUBMIT_RECEIPT_TIMEOUT_MS + 1);
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT when env var is \"5_000_000\" (above MAX)", () => {
    process.env[ENV_KEY] = "5000000";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("returns DEFAULT for scientific notation \"1e9\" (above MAX)", () => {
    process.env[ENV_KEY] = "1e9";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  // ► Equality with MAX
  it("accepts MAX exactly (300_000 → 300_000)", () => {
    process.env[ENV_KEY] = "300000";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      MAX_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  // ► Mid-range + Math.floor
  it("accepts a mid-range integer (\"30_000\" → 30_000)", () => {
    process.env[ENV_KEY] = "30000";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(30_000);
  });

  // MODULAR: 30_000 is within range → floor wins. Only the
  // case at 300_000.4 actually exercises floor-then-bounds —
  // included so a future revert to bounds-then-floor surfaces
  // immediately on the server side too.
  it("floors a fractional value (\"30_000.7\" → 30_000)", () => {
    process.env[ENV_KEY] = "30000.7";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(30_000);
  });

  it("floors a fractional value at the MIN boundary (\"5_000.9\" → 5_000)", () => {
    process.env[ENV_KEY] = "5000.9";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      MIN_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  it("accepts a fractional value above MAX before flooring (\"300_000.4\" → 300_000)", () => {
    // 300_000.4 floored to 300_000 → passes upper bound → 300_000.
    process.env[ENV_KEY] = "300000.4";
    expect(parseServerSubmitReceiptTimeoutMs()).toBe(
      MAX_SUBMIT_RECEIPT_TIMEOUT_MS,
    );
  });

  // ► Bounds-import sanity (single source of truth)
  // MODULAR: the server file re-exports the bounds from
  // submit-config.ts. These three assertions confirm the
  // re-export wire-up is intact — if the imports ever drift
  // the tests fail loudly rather than silently swap to a
  // drifted literal.
  it("re-exports DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS = 60_000", () => {
    expect(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS).toBe(60_000);
  });

  it("re-exports MIN_SUBMIT_RECEIPT_TIMEOUT_MS = 5_000", () => {
    expect(MIN_SUBMIT_RECEIPT_TIMEOUT_MS).toBe(5_000);
  });

  it("re-exports MAX_SUBMIT_RECEIPT_TIMEOUT_MS = 300_000", () => {
    expect(MAX_SUBMIT_RECEIPT_TIMEOUT_MS).toBe(300_000);
  });
});
