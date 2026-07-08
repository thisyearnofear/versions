// MODULAR: tests for the env-var parser in
// src/lib/submit-config.ts. Mutates process.env per case and
// restores the host-shell value in afterEach so sibling test
// files aren't affected. The production code path
// (SUBMIT_RECEIPT_TIMEOUT_MS at module load) is not under test
// — only the parser function itself.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseSubmitReceiptTimeoutMs,
  DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
  MIN_SUBMIT_RECEIPT_TIMEOUT_MS,
  MAX_SUBMIT_RECEIPT_TIMEOUT_MS,
} from "@/lib/submit-config";

const ENV_KEY = "NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS";

describe("parseSubmitReceiptTimeoutMs", () => {
  // MODULAR: capture the host shell's value at module load so
  // we can restore it after the suite. If the test machine has
  // NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS set (unusual but
  // possible — e.g. a developer running vitest after setting
  // it for a manual curl test) we don't accidentally clobber
  // their environment.
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
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is the empty string", () => {
    process.env[ENV_KEY] = "";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is non-numeric (\"abc\")", () => {
    process.env[ENV_KEY] = "abc";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is the literal string \"NaN\"", () => {
    // Number("NaN") === NaN → Number.isFinite(NaN) === false → default.
    process.env[ENV_KEY] = "NaN";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is the literal string \"Infinity\"", () => {
    // Number("Infinity") === Infinity → Number.isFinite(Infinity) === false → default.
    process.env[ENV_KEY] = "Infinity";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  // ► Below MIN
  it("returns DEFAULT when env var is \"0\" (below MIN, also viem's forever-poll sentinel)", () => {
    // viem treats timeout: 0 as forever; the MIN floor catches this case.
    process.env[ENV_KEY] = "0";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is \"-1\" (below MIN)", () => {
    process.env[ENV_KEY] = "-1";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is one millisecond below MIN", () => {
    process.env[ENV_KEY] = String(MIN_SUBMIT_RECEIPT_TIMEOUT_MS - 1);
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  // ► Equality with MIN
  it("accepts MIN exactly (5_000 → 5_000)", () => {
    process.env[ENV_KEY] = "5000";
    expect(parseSubmitReceiptTimeoutMs()).toBe(MIN_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  // ► Above MAX
  it("returns DEFAULT when env var is one millisecond above MAX", () => {
    process.env[ENV_KEY] = String(MAX_SUBMIT_RECEIPT_TIMEOUT_MS + 1);
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT when env var is \"5_000_000\" (above MAX)", () => {
    process.env[ENV_KEY] = "5000000";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("returns DEFAULT for scientific notation \"1e9\" (1_000_000_000 — above MAX)", () => {
    process.env[ENV_KEY] = "1e9";
    expect(parseSubmitReceiptTimeoutMs()).toBe(DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  // ► Equality with MAX
  it("accepts MAX exactly (300_000 → 300_000)", () => {
    process.env[ENV_KEY] = "300000";
    expect(parseSubmitReceiptTimeoutMs()).toBe(MAX_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  // ► Mid-range + Math.floor
  it("accepts a mid-range integer (\"30_000\" → 30_000)", () => {
    process.env[ENV_KEY] = "30000";
    expect(parseSubmitReceiptTimeoutMs()).toBe(30_000);
  });

  it("floors a fractional value (\"30_000.7\" → 30_000)", () => {
    process.env[ENV_KEY] = "30000.7";
    expect(parseSubmitReceiptTimeoutMs()).toBe(30_000);
  });

  it("floors a fractional value at the MIN boundary (\"5_000.9\" → 5_000)", () => {
    process.env[ENV_KEY] = "5000.9";
    expect(parseSubmitReceiptTimeoutMs()).toBe(MIN_SUBMIT_RECEIPT_TIMEOUT_MS);
  });

  it("accepts a fractional mid-range value above MAX before flooring (\"300_000.4\" → 300_000)", () => {
    // 300_000.4 passes the upper-bound check then Math.floor truncates.
    process.env[ENV_KEY] = "300000.4";
    expect(parseSubmitReceiptTimeoutMs()).toBe(MAX_SUBMIT_RECEIPT_TIMEOUT_MS);
  });
});
