// MODULAR: Server-side supervisor identity resolver for the
// wallet-free journey. Supervisor API routes used to 401 whenever
// no wallet session existed; now they resolve identity from either
//  1. a connected wallet session (takes precedence), or
//  2. the `x-supervisor-guest` header carrying a per-device ID,
//     from which a deterministic pseudo-wallet is derived.
// The pseudo-wallet is a valid-format EVM address (0x + 40 hex
// chars) so it flows through `ensureUser` / `ensureProfile` and the
// supervisor tables with zero schema change. It is NOT a spendable
// key — it never signs anything; it is only an identity key.
//
// Guest rows are per-device by design: saved briefs, recent
// searches, and interests persist in the DB under the derived
// wallet. When a visitor later connects a real wallet, their
// session wallet takes over; the guest rows stay orphaned (an
// acceptable demo-stage trade-off, documented in the README).

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export const GUEST_HEADER = "x-supervisor-guest";

export type SupervisorIdentity =
  | { mode: "wallet"; wallet: string }
  | { mode: "guest"; wallet: string; guestId: string };

// MODULAR: deterministic pseudo-wallet from a guest ID. sha256 →
// first 40 hex chars → `0x…` (20 bytes, lowercase). Deterministic
// so the same device keeps the same shortlist across requests.
export function guestWalletFromId(guestId: string): string {
  const digest = createHash("sha256").update(guestId).digest("hex");
  return `0x${digest.slice(0, 40)}`;
}

export async function resolveSupervisorIdentity(
  req: NextRequest,
): Promise<SupervisorIdentity | null> {
  // 1. Connected wallet wins when present.
  try {
    const session = await auth();
    const wallet = (session?.user as { walletAddress?: string } | undefined)?.walletAddress;
    if (wallet) return { mode: "wallet", wallet };
  } catch {
    // auth() can throw when NextAuth is not configured (mock mode
    // without NEXTAUTH_SECRET). Fall through to the guest path.
  }

  // 2. Otherwise a per-device guest header.
  const guestId = req.headers.get(GUEST_HEADER);
  if (!guestId || guestId.trim().length === 0) return null;
  return { mode: "guest", wallet: guestWalletFromId(guestId.trim()), guestId: guestId.trim() };
}
