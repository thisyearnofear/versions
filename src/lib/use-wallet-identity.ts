"use client";

import { useEffect, useState } from "react";
import type { WalletIdentity } from "@/lib/wallet-identity";
import { shortAddress } from "@/lib/wallet-identity";
import { apiCredentials, apiUrl } from "@/lib/api-base";

type Envelope = {
  success?: boolean;
  data?: { identity?: WalletIdentity };
};

export function useWalletIdentity(address: string | null | undefined) {
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      // MODULAR: reset when wallet disconnects mid-session. Suppressed below
      // intentionally — this is a synchronous reset-on-condition effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIdentity(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setIdentity({
      address: address.toLowerCase(),
      ens: null,
      displayName: shortAddress(address),
      avatar: null,
      source: "none",
    });

    void (async () => {
      try {
        const res = await fetch(apiUrl(`/api/v1/identity/${encodeURIComponent(address)}`), {
          credentials: apiCredentials(),
        });
        if (!res.ok) return;
        const json = (await res.json()) as Envelope;
        const next = json.data?.identity;
        if (!cancelled && next) setIdentity(next);
      } catch {
        // Keep truncated address fallback.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { identity, loading };
}
