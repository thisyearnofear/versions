// MODULAR: Guest identity for the wallet-free supervisor journey.
// A supervisor can save briefs, log searches, and mark licensing
// interests without connecting a wallet. The client generates one
// stable per-device ID (localStorage) and sends it as the
// `x-supervisor-guest` header on every api-client request. The
// server derives a deterministic pseudo-wallet from it
// (src/lib/supervisor-identity.ts) so the existing supervisor
// tables keep working with zero schema change. Connecting a real
// wallet later is an optional upgrade — the wallet takes
// precedence over the guest header server-side.

const GUEST_ID_KEY = "versions.guestId";

// MODULAR: read-or-create the per-device guest ID. Safe on the
// server (typeof window guard) because api-client is also imported
// by server components for normalizeFeedRow etc.
export function getGuestId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable (private mode / storage disabled) —
    // the request simply goes out without a guest identity.
    return null;
  }
}
