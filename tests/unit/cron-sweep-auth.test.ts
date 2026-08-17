// MODULAR: sweep route auth guard. /api/cron/sweep drives settlement
// retries, the authoritative outbox drain, and retention DELETEs — the
// shared-secret check must reject missing/wrong headers, while failing open
// (with a route-level warning) when CRON_SECRET is unset so existing
// deploys keep ticking.

import { describe, it, expect } from "vitest";
import { isAuthorized } from "../../src/app/api/cron/sweep/route";

const SECRET = "super-secret-cron-token";

describe("sweep route auth", () => {
  it("fails open when no secret is configured (rollout compatibility)", () => {
    expect(isAuthorized(undefined, null)).toBe(true);
    expect(isAuthorized(undefined, "anything")).toBe(true);
    expect(isAuthorized("", null)).toBe(true);
  });

  it("rejects a missing header once a secret is configured", () => {
    expect(isAuthorized(SECRET, null)).toBe(false);
  });

  it("rejects a wrong header", () => {
    expect(isAuthorized(SECRET, "not-the-secret")).toBe(false);
  });

  it("rejects a same-length wrong header (timing-safe path)", () => {
    expect(isAuthorized(SECRET, "x".repeat(SECRET.length))).toBe(false);
  });

  it("accepts the exact secret", () => {
    expect(isAuthorized(SECRET, SECRET)).toBe(true);
  });
});
