// MODULAR: pure-helper tests for the receipts feed — labels, amount
// formatting, and the SSE wallet-match predicate. No DB, no jsdom.

import { describe, it, expect } from 'vitest';
import { SOURCE_LABELS, formatReceiptAmount, receiptMatchesWallet } from '../../src/lib/receipts';

const WALLET = '0xAbCd000000000000000000000000000000001234';

describe('SOURCE_LABELS', () => {
  it('labels every receipt source', () => {
    expect(SOURCE_LABELS.split).toBe('Publish split');
    expect(SOURCE_LABELS.tip).toBe('Tip');
    expect(SOURCE_LABELS.play).toBe('Per-play payout');
  });
});

describe('formatReceiptAmount', () => {
  it('keeps sub-cent precision', () => {
    expect(formatReceiptAmount('0.0005')).toBe('+0.0005');
  });

  it('trims trailing zeros', () => {
    expect(formatReceiptAmount('1.500000')).toBe('+1.5');
    expect(formatReceiptAmount('2.000000')).toBe('+2');
  });

  it('passes through non-numeric input with a plus sign', () => {
    expect(formatReceiptAmount('n/a')).toBe('+n/a');
  });
});

describe('receiptMatchesWallet', () => {
  it('matches leg_settled / play economy events via toWallet', () => {
    expect(receiptMatchesWallet({ kind: 'leg_settled', toWallet: WALLET }, WALLET)).toBe(true);
    expect(receiptMatchesWallet({ kind: 'play', toWallet: WALLET }, WALLET)).toBe(true);
  });

  it('matches tip events via toWallet and tip-received via artistWallet', () => {
    expect(receiptMatchesWallet({ kind: 'tip', toWallet: WALLET }, WALLET)).toBe(true);
    expect(receiptMatchesWallet({ kind: 'tip_batch_settled', toWallet: WALLET }, WALLET)).toBe(true);
    expect(receiptMatchesWallet({ artistWallet: WALLET, amountUsdc: '0.0005' }, WALLET)).toBe(true);
  });

  it('compares case-insensitively (mixed checksum casings)', () => {
    expect(receiptMatchesWallet({ toWallet: WALLET.toLowerCase() }, WALLET.toUpperCase())).toBe(true);
    expect(receiptMatchesWallet({ artistWallet: WALLET.toUpperCase() }, WALLET.toLowerCase())).toBe(true);
  });

  it('rejects other wallets, missing fields, and empty target', () => {
    expect(receiptMatchesWallet({ toWallet: '0x' + 'f'.repeat(40) }, WALLET)).toBe(false);
    expect(receiptMatchesWallet({ kind: 'leg_settled' }, WALLET)).toBe(false);
    expect(receiptMatchesWallet({ toWallet: 42 }, WALLET)).toBe(false);
    expect(receiptMatchesWallet({ toWallet: WALLET }, '')).toBe(false);
  });
});
