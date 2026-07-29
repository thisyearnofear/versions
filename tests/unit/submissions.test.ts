// MODULAR: submissions service tests. Uses PGlite for DB + vi.mock for db injection.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSubmissionsService, verifyArtistSignature } = await import('../../src/services/submissions');
const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');
const { mkSubmission } = await import('../helpers/fixtures');
const { submissions } = await import('../../src/lib/schema');
const { eq } = await import('drizzle-orm');

const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;
let arc: Awaited<ReturnType<typeof createArcAdapter>>;
let service: ReturnType<typeof createSubmissionsService>;

beforeAll(async () => {
  await _initTestDb();
  arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  service = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
});

beforeEach(async () => {
  await _resetTestDb();
});

async function createVerifiedSubmission(artistIndex: 0 | 1 | 2 | 3 = 1) {
  const sig = await signMessage(artistIndex, 'VERSIONS_LEPTON_SUBMIT');
  const r = await service.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    durationSeconds: 180,
    metadata: {
      title: 'Test',
      artistName: 'Test Artist',
      versionType: 'demo',
      genre: 'rock',
      mood: 'energetic',
    },
    artistWallet: TEST_ADDRESSES[`acc${artistIndex}` as keyof typeof TEST_ADDRESSES] as `0x${string}`,
    signature: sig,
  });
  if (!r.ok) throw new Error('createSubmission failed: ' + r.error);
  return r.submission;
}

describe('verifyArtistSignature', () => {
  it('accepts a valid signature', async () => {
    const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
    const r = await verifyArtistSignature({
      artistWallet: TEST_ADDRESSES.acc1,
      signature: sig,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const r = await verifyArtistSignature({
      artistWallet: TEST_ADDRESSES.acc1,
      signature: '0x' + 'a'.repeat(130),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed wallet', async () => {
    const r = await verifyArtistSignature({
      artistWallet: 'not-a-wallet',
      signature: '0x' + 'a'.repeat(130),
    });
    expect(r.ok).toBe(false);
  });
});

describe('createSubmission', () => {
  it('creates a row with status=pending_payment', async () => {
    const sub = await createVerifiedSubmission(1);
    expect(sub.status).toBe('pending_payment');
    expect(sub.fee_quote_usdc).toBe('0.50');
    expect(sub.audio_size_bytes).toBe(1024);
  });

  it('rejects bad signature', async () => {
    const r = await service.createSubmission({
      audioPath: 'x.mp3',
      contentType: 'audio/mpeg',
      sizeBytes: 1024,
      metadata: { title: 'T', artistName: 'A', versionType: 'demo' },
      artistWallet: TEST_ADDRESSES.acc1,
      signature: 'not-a-real-signature',
    });
    expect(r.ok).toBe(false);
  });
});

describe('getSubmission / listQueue', () => {
  it('returns null for unknown id', async () => {
    expect(await service.getSubmissionAsync('nope')).toBeNull();
  });

  it('returns the row with empty ratings/legs', async () => {
    const sub = await createVerifiedSubmission(2);
    const got = await service.getSubmissionAsync(sub.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(sub.id);
    expect(got!.ratings).toEqual([]);
    expect(got!.settlement_legs).toEqual([]);
  });

  it('listQueueAsync returns submissions in awaiting_curation', async () => {
    expect((await service.listQueueAsync()).length).toBe(0);
  });
});

describe('verifyPayment', () => {
  it('mock Arc flips status to awaiting_curation', async () => {
    const sub = await createVerifiedSubmission(3);
    const fakeTx = '0x' + 'b'.repeat(64);
    const r = await service.verifyPayment(sub.id, fakeTx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.submission.status).toBe('awaiting_curation');
      expect(r.submission.payment_tx_hash).toBe(fakeTx);
      expect(r.submission.payment_verified_at).not.toBeNull();
    }
  });

  it('rejects when submission is not pending_payment', async () => {
    const sub = await createVerifiedSubmission(1);
    const fakeTx = '0x' + 'c'.repeat(64);
    await service.verifyPayment(sub.id, fakeTx);
    const r2 = await service.verifyPayment(sub.id, fakeTx);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/Cannot verify/);
  });

  it('rejects unknown submission', async () => {
    const r = await service.verifyPayment('nope', '0x' + 'd'.repeat(64));
    expect(r.ok).toBe(false);
  });

  it('rejects a tx hash already used by another submission (replay guard)', async () => {
    const sub1 = await createVerifiedSubmission(1);
    const sub2 = await createVerifiedSubmission(2);
    const tx = '0x' + 'e'.repeat(64);
    const r1 = await service.verifyPayment(sub1.id, tx);
    expect(r1.ok).toBe(true);
    const r2 = await service.verifyPayment(sub2.id, tx);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/already used/);
  });
});

describe('verifyPayment (real mode: calldata decode)', () => {
  // MODULAR: a fee payment is an ERC-20 call INTO the USDC contract;
  // the true recipient + amount live in the transfer calldata. These
  // tests stub arc.getTransaction with mock: false to exercise the
  // real-mode decode path.
  const USDC = '0x' + 'aa'.repeat(20);
  const FEE_MICRO = 500_000n; // 0.50 USDC

  function calldata(to: string, amountMicro: bigint): string {
    return '0xa9059cbb' + '0'.repeat(24) + to.slice(2).toLowerCase() + amountMicro.toString(16).padStart(64, '0');
  }

  function realService(tx: Partial<{ to: string; from: string; input: string | null }>) {
    const stubArc = {
      ...arc,
      getTransaction: async () => ({
        hash: '0x' + 'f'.repeat(64),
        status: 'finalized' as const,
        blockNumber: '1',
        confirmations: 1,
        to: USDC,
        input: calldata(TEST_PLATFORM_WALLET, FEE_MICRO),
        mock: false,
        ...tx,
      }),
    };
    return createSubmissionsService({
      arc: stubArc as typeof arc,
      platformWallet: TEST_PLATFORM_WALLET,
      usdcContract: USDC,
    });
  }

  it('accepts a finalized USDC transfer to the platform for at least the fee', async () => {
    const sub = await createVerifiedSubmission(1);
    const svc = realService({ from: TEST_ADDRESSES.acc1 });
    const r = await svc.verifyPayment(sub.id, '0x' + 'f'.repeat(64));
    expect(r.ok).toBe(true);
  });

  it('rejects when tx.to is not the USDC contract', async () => {
    const sub = await createVerifiedSubmission(1);
    const svc = realService({ from: TEST_ADDRESSES.acc1, to: TEST_PLATFORM_WALLET });
    const r = await svc.verifyPayment(sub.id, '0x' + 'f'.repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/USDC contract/);
  });

  it('rejects when the sender is not the submitting artist', async () => {
    const sub = await createVerifiedSubmission(1);
    const svc = realService({ from: TEST_ADDRESSES.acc2 });
    const r = await svc.verifyPayment(sub.id, '0x' + 'f'.repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sender/);
  });

  it('rejects when the decoded recipient is not the platform wallet', async () => {
    const sub = await createVerifiedSubmission(1);
    const svc = realService({
      from: TEST_ADDRESSES.acc1,
      input: calldata(TEST_ADDRESSES.acc2, FEE_MICRO),
    });
    const r = await svc.verifyPayment(sub.id, '0x' + 'f'.repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/recipient/);
  });

  it('rejects when the decoded amount is below the fee', async () => {
    const sub = await createVerifiedSubmission(1);
    const svc = realService({
      from: TEST_ADDRESSES.acc1,
      input: calldata(TEST_PLATFORM_WALLET, FEE_MICRO - 1n),
    });
    const r = await svc.verifyPayment(sub.id, '0x' + 'f'.repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/amount below fee/);
  });

  it('rejects when the tx has no transfer calldata', async () => {
    const sub = await createVerifiedSubmission(1);
    const svc = realService({ from: TEST_ADDRESSES.acc1, input: null });
    const r = await svc.verifyPayment(sub.id, '0x' + 'f'.repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no transfer calldata/);
  });
});

describe('mkSubmission fixture', () => {
  it('overrides work', () => {
    const s = mkSubmission({ title: 'X' });
    expect(s.title).toBe('X');
  });
});

// Reference unused symbols to keep tree-shakers honest
void submissions; void eq;
