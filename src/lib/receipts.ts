// MODULAR: pure helpers for the artist receipts feed. Kept out of the
// component so labels, amount formatting, and the SSE wallet-match
// predicate are unit-testable without jsdom. Tx display reuses
// shortHash/txUrl from lib/explorer.

import type { ReceiptSource } from './api-client';

export const SOURCE_LABELS: Record<ReceiptSource, string> = {
  split: 'Publish split',
  tip: 'Tip',
  play: 'Per-play payout',
};

/**
 * True when a live bus event pays this wallet. Covers EconomyEvent
 * (leg_settled/play carry toWallet; tip kinds carry toWallet too) and
 * TipReceivedEvent (artistWallet). Wallets compare case-insensitively
 * because EVM addresses arrive in mixed checksum casings.
 */
export function receiptMatchesWallet(evt: Record<string, unknown>, wallet: string): boolean {
  if (!wallet) return false;
  const target = wallet.toLowerCase();
  for (const key of ['toWallet', 'artistWallet']) {
    const v = evt[key];
    if (typeof v === 'string' && v.toLowerCase() === target) return true;
  }
  return false;
}

/** "+0.0005" — sub-cent precision, trailing zeros trimmed. */
export function formatReceiptAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `+${amount}`;
  const s = n.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `+${s}`;
}
