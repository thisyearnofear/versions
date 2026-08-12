// MODULAR: Resolve a wallet to a human identity (ENS / Basename / Farcaster)
// via ensdata.net (primary) and web3.bio (fallback). Pure fetch helpers —
// the API route caches/proxies; the client hook consumes our own endpoint.

export type WalletIdentity = {
  address: string;
  ens: string | null;
  displayName: string;
  avatar: string | null;
  source: "ensdata" | "web3.bio" | "none";
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isWalletAddress(value: string): value is `0x${string}` {
  return ADDRESS_RE.test(value);
}

export function shortAddress(address: string): string {
  if (!isWalletAddress(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type EnsDataResponse = {
  address?: string;
  ens?: string | null;
  ens_primary?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
  avatar_small?: string | null;
};

type Web3BioProfile = {
  address?: string;
  identity?: string;
  platform?: string;
  displayName?: string | null;
  avatar?: string | null;
};

const PLATFORM_RANK: Record<string, number> = {
  ens: 0,
  basenames: 1,
  farcaster: 2,
  lens: 3,
};

async function fetchJson<T>(url: string, timeoutMs = 4_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fromEnsData(address: string, data: EnsDataResponse | null): WalletIdentity | null {
  if (!data) return null;
  const ens = data.ens_primary || data.ens || null;
  const avatar = data.avatar_url || data.avatar || data.avatar_small || null;
  if (!ens && !avatar) return null;
  return {
    address: address.toLowerCase(),
    ens,
    displayName: ens || shortAddress(address),
    avatar,
    source: "ensdata",
  };
}

function fromWeb3Bio(address: string, profiles: Web3BioProfile[] | null): WalletIdentity | null {
  if (!profiles?.length) return null;
  const ranked = [...profiles].sort(
    (a, b) => (PLATFORM_RANK[a.platform ?? ""] ?? 99) - (PLATFORM_RANK[b.platform ?? ""] ?? 99),
  );
  const best = ranked.find((p) => p.identity || p.displayName || p.avatar);
  if (!best) return null;
  const ens =
    best.platform === "ens" || best.platform === "basenames"
      ? best.identity || best.displayName || null
      : best.identity || null;
  return {
    address: address.toLowerCase(),
    ens,
    displayName: best.displayName || best.identity || shortAddress(address),
    avatar: best.avatar || null,
    source: "web3.bio",
  };
}

/** Server-side resolve. ensdata first; web3.bio if no ENS/avatar. */
export async function resolveWalletIdentity(address: string): Promise<WalletIdentity> {
  const normalized = address.toLowerCase();
  const fallback: WalletIdentity = {
    address: normalized,
    ens: null,
    displayName: shortAddress(normalized),
    avatar: null,
    source: "none",
  };
  if (!isWalletAddress(normalized)) return fallback;

  const ens = await fetchJson<EnsDataResponse>(`https://api.ensdata.net/${normalized}`);
  const fromEns = fromEnsData(normalized, ens);
  if (fromEns?.ens) return fromEns;

  const bio = await fetchJson<Web3BioProfile[]>(`https://api.web3.bio/profile/${normalized}`);
  const fromBio = fromWeb3Bio(normalized, bio);
  if (fromBio) return fromBio;

  return fromEns ?? fallback;
}
