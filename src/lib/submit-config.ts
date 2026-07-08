// MODULAR: client-side submit-flow configuration. The bounds
// constants + parser live here so any future caller (telemetry
// api, retries loop, etc.) reads the same config without
// re-deriving the bounds or hardcoding the env var name. The
// previous location (src/components/submit/use-submit-payment.ts)
// coupled the config to the only consumer; co-locating all
// submit-side client config in one module makes the boundary
// clearer and the test import path shorter.
//
// SERVER COUNTERPART: src/lib/submit-config.server.ts re-exports
// the bounds from this module and binds the same parser to a
// non-NEXT_PUBLIC env var (`SUBMIT_RECEIPT_TIMEOUT_MS`). The
// Next.js bundler enforces the `.server.ts` filename, so any
// accidental client import is a compile error. The settlement
// sweeper (`src/services/settlement-sweeper.ts`) reads the
// server counterpart for its polling cadence.
//
// MODULAR: the internal helper below is shared across client
// and server parsers — both call parseSubmitReceiptTimeoutMsFrom
// with their own env-var value. This keeps bounds + parsing
// logic in one place; adding a third caller (e.g., a worker
// job) is a one-line re-export.
//
// MODULAR: client-side parse is evaluated at module-load
// because Next.js inlines the NEXT_PUBLIC_* value into the
// client bundle at build time, so the env var can't drift at
// runtime — a single parse avoids per-render Number() cost.
// Server-side processes (and dev-mode hot-reload) re-read
// process.env at boot, so the same pattern holds there.
export const DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS = 60_000;
export const MIN_SUBMIT_RECEIPT_TIMEOUT_MS = 5_000;
export const MAX_SUBMIT_RECEIPT_TIMEOUT_MS = 300_000;

// MODULAR: shared helper — accepts the raw env-var string
// (caller may pre-strip / pre-process if needed) and returns
// a bounded integer millisecond value. Floor BEFORE bounds is
// deliberate: values like `300_000.4` would otherwise trip the
// upper bound and fall through to DEFAULT while `30000.7`
// cleanly floors — floor-then-bounds keeps fractional input
// consistent (operator's `30000.5` or `300_000.4` returns the
// nearest lower integer in-range, not a wildly different
// default). Never throws — returns DEFAULT_SUBMIT_* on any
// out-of-bounds / unparseable input so downstream code never
// crashes on operator typo.
export function parseSubmitReceiptTimeoutMsFrom(
  raw: string | undefined,
): number {
  if (!raw) return DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS;
  const floored = Math.floor(parsed);
  if (
    floored < MIN_SUBMIT_RECEIPT_TIMEOUT_MS ||
    floored > MAX_SUBMIT_RECEIPT_TIMEOUT_MS
  ) {
    return DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS;
  }
  return floored;
}

// MODULAR: client-specific entry point. Reads
// NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS (inlined into the
// client bundle at build time). For server-side reads, see
// parseServerSubmitReceiptTimeoutMs in submit-config.server.ts.
export function parseSubmitReceiptTimeoutMs(): number {
  return parseSubmitReceiptTimeoutMsFrom(
    process.env.NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS,
  );
}

// MODULAR: production consumers read this. Bound to the parser's
// module-load invocation so the value is stable across renders.
// parseSubmitReceiptTimeoutMs never throws (default fallback
// always wins on bad input), so this assignment can never fail.
export const SUBMIT_RECEIPT_TIMEOUT_MS = parseSubmitReceiptTimeoutMs();
