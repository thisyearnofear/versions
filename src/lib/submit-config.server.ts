// MODULAR: SERVER-ONLY counterpart of src/lib/submit-config.ts.
// The `.server.ts` filename suffix is enforced by Next.js — any
// accidental client-side import becomes a build error. Use this
// module from anywhere outside the request-time browser path:
// API routes, server-side cron handlers (e.g. /api/cron/sweep),
// long-running workers, queued jobs.
//
// DRY: the parsing logic itself is not duplicated. Both client
// and server parsers call parseSubmitReceiptTimeoutMsFrom in
// the parent module with their own env-var value. Bounds
// (DEFAULT / MIN / MAX) are re-exported from submit-config.ts
// so adding a new caller (e.g. a worker that drains stuck
// settlements) reads the same single source of truth and
// inherits all the existing tests for free.
//
// ENV-VAR NOTE: the client counterpart reads
// NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS because Next.js bakes
// NEXT_PUBLIC_* values into the client bundle at build time.
// The server doesn't have that constraint and reads the value
// at module-load (Node process boot). Operators set
// SUBMIT_RECEIPT_TIMEOUT_MS in their process manager / k8s
// manifest / .env without touching the codebase. Dev-mode
// hot-reload still re-evaluates module-load on env changes
// since Next dev triggers fresh imports on edits.

import {
  parseSubmitReceiptTimeoutMsFrom,
  DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
  MIN_SUBMIT_RECEIPT_TIMEOUT_MS,
  MAX_SUBMIT_RECEIPT_TIMEOUT_MS,
} from "@/lib/submit-config";

// MODULAR: re-export bounds so server-side code reads them
// from one of two places (this module OR submit-config) —
// both resolve to the same const. Mainly here for ergonomics:
// future server-side callers import from
// "@/lib/submit-config.server" without needing to know about
// the client module.
export {
  DEFAULT_SUBMIT_RECEIPT_TIMEOUT_MS,
  MIN_SUBMIT_RECEIPT_TIMEOUT_MS,
  MAX_SUBMIT_RECEIPT_TIMEOUT_MS,
};

// MODULAR: server-specific entry point. Reads the non-NEXT
// public env var so server processes can override at runtime
// (deployment-time env injection, not build-time inlining).
// Same bounds + floor-then-bounds semantics as the client
// parser — see parseSubmitReceiptTimeoutMsFrom in submit-config.
//
// MODULAR: this is the knob the settlement sweeper's polling
// cadence reads. Operators on Arc mainnet (or a future chain
// with longer block times) bump SUBMIT_RECEIPT_TIMEOUT_MS
// without redeploying the app.
export function parseServerSubmitReceiptTimeoutMs(): number {
  return parseSubmitReceiptTimeoutMsFrom(process.env.SUBMIT_RECEIPT_TIMEOUT_MS);
}

// MODULAR: production consumers (e.g. settlement-sweeper.ts)
// read this. Bound to the parser's module-load invocation so
// the value is stable across the process lifetime — sweeper
// `start({ intervalMs })` falls back to it if no override is
// passed. parseServerSubmitReceiptTimeoutMs never throws
// (default fallback always wins on bad input), so this
// assignment can never fail.
export const SUBMIT_RECEIPT_TIMEOUT_MS =
  parseServerSubmitReceiptTimeoutMs();
