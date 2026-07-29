// MODULAR: tip batch settlement tests. Verified x402 proof rows ARE
// the queue — these tests pin the aggregation contract (one transfer
// per artist for the sum of queued tips), the retry contract (failed
// send leaves rows 'verified'), and idempotency (settled rows are
// never re-sent).

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { initTestDb, getTestDb, resetTestDb, closeTestDb } from '../helpers/db';

vi.mock('@/lib/db', () => ({
  get db() { return getTestDb(); },
}));

import { createTipSettlementService } from '../../src/services/tips';
import type { ArcAdapter } from '../../src/adapters/arc';
import { x402Proofs } from '../../src/lib/schema';

const PLATFORM = '0x000000000000000000000000000000000000d3ad';
const ARTIST_A = '0x00000000000000000000000000000000000000a1';
const ARTIST_B = '0x00000000000000000000000000000000000000b2';
const MOCK_HASH = '0x' + 'ab'.repeat(32);

const sendTransfer = vi.fn(async () => ({ hash: MOCK_HASH, mock: true }));
const arc = { sendTransfer } as unknown as ArcAdapter;

async function insertProof({
  artistWallet,
  amountMicroUsdc,
  status = 'verified',
}: {
  artistWallet: string;
  amountMicroUsdc: string;
  status?: string;
}) {
  const puid = randomUUID();
  await getTestDb().insert(x402Proofs).values({
    id: randomUUID(),
    puid,
    resourceUrl: '/api/x402/tip',
    scheme: 'exact',
    network: 'arc-testnet',
    asset: 'USDC',
    payTo: PLATFORM,
    amountMicroUsdc,
    validUntil: new Date(Date.now() + 300_000),
    tipperWallet: '0x0000000000000000000000000000000000000001',
    artistWallet,
    message: null,
    signature: '0x' + '00'.repeat(65),
    txHash: status === 'settled' ? MOCK_HASH : null,
    status,
    createdAt: new Date(),
    settledAt: status === 'settled' ? new Date() : null,
  });
  return puid;
}

describe('tip batch settlement', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    sendTransfer.mockClear();
    sendTransfer.mockImplementation(async () => ({ hash: MOCK_HASH, mock: true }));
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('settleQueuedFor aggregates all queued tips into ONE transfer for the sum', async () => {
    const tips = createTipSettlementService({ arc, platformWallet: PLATFORM });
    await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '100' });
    await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '250' });
    await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '1' });

    const r = await tips.settleQueuedFor(ARTIST_A);
    expect(r.status).toBe('settled');
    expect(r.settledCount).toBe(3);
    expect(r.amountMicroUsdc).toBe('351');
    expect(r.hash).toBe(MOCK_HASH);
    expect(r.mock).toBe(true);

    expect(sendTransfer).toHaveBeenCalledTimes(1);
    const args = sendTransfer.mock.calls[0][0] as { from: string; to: string; amountUsdc: string };
    expect(args.from).toBe(PLATFORM);
    expect(args.to).toBe(ARTIST_A);
    expect(args.amountUsdc).toBe('0.000351');

    const rows = await getTestDb().select().from(x402Proofs).where(eq(x402Proofs.artistWallet, ARTIST_A));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('settled');
      expect(row.txHash).toBe(MOCK_HASH);
      expect(row.settledAt).not.toBeNull();
    }
  });

  it('settleQueuedFor ignores rows for other artists and non-verified rows', async () => {
    const tips = createTipSettlementService({ arc, platformWallet: PLATFORM });
    await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '100' });
    await insertProof({ artistWallet: ARTIST_B, amountMicroUsdc: '500' });
    const settledPuid = await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '999', status: 'settled' });

    const r = await tips.settleQueuedFor(ARTIST_A);
    expect(r.settledCount).toBe(1);
    expect(r.amountMicroUsdc).toBe('100');

    // Already-settled row untouched; other artist still queued
    const status = await tips.getTipStatus(settledPuid);
    expect(status.status).toBe('settled');
    const [bRow] = await getTestDb().select().from(x402Proofs).where(eq(x402Proofs.artistWallet, ARTIST_B));
    expect(bRow.status).toBe('verified');
  });

  it('settleQueuedFor with an empty queue sends nothing', async () => {
    const tips = createTipSettlementService({ arc, platformWallet: PLATFORM });
    const r = await tips.settleQueuedFor(ARTIST_A);
    expect(r.status).toBe('queued');
    expect(r.settledCount).toBe(0);
    expect(sendTransfer).not.toHaveBeenCalled();
  });

  it('a failed send leaves rows verified (retryable), never marks settled', async () => {
    const tips = createTipSettlementService({ arc, platformWallet: PLATFORM });
    const puid = await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '100' });
    sendTransfer.mockImplementationOnce(async () => {
      throw new Error('rpc down');
    });

    const r = await tips.settleQueuedFor(ARTIST_A);
    expect(r.status).toBe('queued');
    expect(r.settledCount).toBe(0);
    expect(r.hash).toBeNull();

    const [row] = await getTestDb().select().from(x402Proofs).where(eq(x402Proofs.puid, puid));
    expect(row.status).toBe('verified');
    expect(row.txHash).toBeNull();

    // Retry succeeds (sweeper path)
    const r2 = await tips.settleQueuedFor(ARTIST_A);
    expect(r2.status).toBe('settled');
    expect(r2.settledCount).toBe(1);
  });

  it('flushAll settles every artist with queued tips, one transfer each', async () => {
    const tips = createTipSettlementService({ arc, platformWallet: PLATFORM });
    await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '100' });
    await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '200' });
    await insertProof({ artistWallet: ARTIST_B, amountMicroUsdc: '50' });

    const r = await tips.flushAll();
    expect(r.artists).toBe(2);
    expect(r.settled).toBe(3);
    expect(sendTransfer).toHaveBeenCalledTimes(2);

    // Idempotent: second flush finds nothing
    const r2 = await tips.flushAll();
    expect(r2.artists).toBe(0);
    expect(r2.settled).toBe(0);
    expect(sendTransfer).toHaveBeenCalledTimes(2);
  });

  it('getTipStatus maps verified → queued and unknown puid → unknown', async () => {
    const tips = createTipSettlementService({ arc, platformWallet: PLATFORM });
    const puid = await insertProof({ artistWallet: ARTIST_A, amountMicroUsdc: '100' });
    expect((await tips.getTipStatus(puid)).status).toBe('queued');
    expect((await tips.getTipStatus('nope')).status).toBe('unknown');
  });
});
