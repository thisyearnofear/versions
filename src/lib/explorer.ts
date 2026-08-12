// MODULAR: single source for Arc explorer links. Every surface that shows
// a tx hash (economy ticker, dashboards, submit flow) builds its URL here
// so switching networks is one env var. Client-safe: NEXT_PUBLIC_* only.

export const EXPLORER_BASE = (
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || 'https://testnet.arcscan.app'
).replace(/\/$/, '');

export function txUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
}

/** ArcScan address page for the ERC-8183 Agentic Commerce contract + job note. */
export function jobUrl(jobId: string, contractAddress?: string | null): string {
  const contract =
    contractAddress ||
    process.env.NEXT_PUBLIC_ARC_ERC8183_CONTRACT ||
    process.env.ARC_ERC8183_CONTRACT ||
    '0x0747EEf0706327138c69792bF28Cd525089e4583';
  return `${EXPLORER_BASE}/address/${contract}?job=${encodeURIComponent(jobId)}`;
}

/** 0x1234…abcd — for compact ticker rows. */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

/** 0x1234…abcd for wallet addresses; same truncation, separate name for call-site clarity. */
export function shortAddress(address: string): string {
  return shortHash(address);
}
