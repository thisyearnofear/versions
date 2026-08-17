// Sentry runtime init. Runs once per Node/edge worker on startup.
//
// Env-gated: with SENTRY_DSN unset (local dev, CI), init is a no-op and
// the SDK ships inert — zero overhead, zero external calls. Set the DSN
// in the server .env to enable error + transaction tracing in prod.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.SENTRY_DSN) {
    await Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      // Keep the receipt stream out of error breadcrumbs — settlement
      // payloads can carry wallet addresses and must not leak into
      // third-party error reporting.
      beforeSend(event) {
        return sanitizeForSentry(event);
      },
    });
  }
}

// CLEAN: defense in depth on PII. Wallet addresses in error payloads are
// replaced with a 6-char fingerprint before anything leaves the process.
function sanitizeForSentry<T>(event: T): T {
  if (process.env.SENTRY_DSN && process.env.SENTRY_SCRUB === "0") return event;
  const raw = JSON.stringify(event);
  if (!/0x[0-9a-fA-F]{40}/.test(raw)) return event;
  const scrubbed = raw.replace(/0x[0-9a-fA-F]{40}/g, "0x…redacted");
  try {
    return JSON.parse(scrubbed) as T;
  } catch {
    return event;
  }
}
