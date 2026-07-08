// MODULAR: Lightweight client-side funnel analytics. No external
// dependency (PostHog / Mixpanel / etc.) — fires events to a
// first-party /api/telemetry beacon via sendBeacon. SSR-safe:
// every call checks for `typeof window` and returns early.
//
// Events flow: components call `track('event_name', { ...props })`
// → queued → flushed on visibilitychange / pagehide. The beacon
// hits /api/telemetry which logs to the structured logger.
//
// Session ID: generated once per browser session (sessionStorage),
// so a single visitor's funnel can be stitched together server-side.
// Anonymous — no wallet address, no PII. Wallet state is tracked
// only as a boolean (connected: true/false) to measure the
// connect-step drop-off without leaking identity.

const SESSION_KEY = "versions_session_id";
const BEACON_URL = "/api/telemetry";

export type AnalyticsEvent =
  | "page_view"
  | "nav_click"
  | "tour_start"
  | "tour_skip"
  | "tour_complete"
  | "wallet_connect_click"
  | "wallet_connected"
  | "wallet_disconnected"
  | "form_start"
  | "submit_attempt"
  | "submit_success"
  | "submit_failed"
  | "payment_initiated"
  | "payment_tx_broadcast"
  | "payment_verified"
  | "payment_tx_retry"
  | "play_click"
  | "play_success"
  | "play_failed"
  | "feed_load_failed"
  | "listener_profile_failed"
  | "sse_reconnect"
  | "brief_search";

export interface AnalyticsProps {
  [key: string]: string | number | boolean | null | undefined;
}

interface QueuedEvent {
  event: AnalyticsEvent;
  props: AnalyticsProps;
  ts: string;
}

let queue: QueuedEvent[] = [];
let sessionId: string | null = null;
let flushScheduled = false;

function getSessionId(): string {
  if (sessionId) return sessionId;
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      sessionId = existing;
      return sessionId;
    }
    sessionId = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  } catch {
    // sessionStorage blocked — use a random per-call fallback
    return "blocked-" + Math.random().toString(36).slice(2, 10);
  }
}

function flush(): void {
  if (typeof window === "undefined") return;
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];

  const payload = JSON.stringify({
    session: getSessionId(),
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    path: typeof window !== "undefined" ? window.location.pathname : null,
    events: batch,
  });

  try {
    // sendBeacon is non-blocking and survives page unload.
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(BEACON_URL, blob);
    } else {
      // Fallback for browsers without sendBeacon.
      void fetch(BEACON_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Swallow — analytics should never break the app.
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  // Flush on the next microtask to batch events within the same tick.
  Promise.resolve().then(() => {
    flushScheduled = false;
    flush();
  });
}

/**
 * Track a funnel event. Safe to call from any component — SSR
 * calls are no-ops. Props are arbitrary key/value pairs; no PII.
 */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (typeof window === "undefined") return;

  queue.push({
    event,
    props,
    ts: new Date().toISOString(),
  });

  scheduleFlush();
}

/**
 * Initialize the flush listeners. Call once from a client component
 * that mounts at the app root (AnalyticsProvider). Sets up
 * visibilitychange + pagehide flush so events aren't lost on
 * tab switch or navigation.
 */
export function initAnalytics(): void {
  if (typeof window === "undefined") return;

  // Pre-warm the session ID so the first event isn't delayed.
  void getSessionId();

  window.addEventListener("pagehide", flush, { once: false });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  // Flush on beforeunload as a safety net.
  window.addEventListener("beforeunload", flush, { once: false });
}
