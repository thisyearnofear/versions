// MODULAR: dedup tests for the submissions service. Pins the
// (audioSha256, artist_wallet) lookup-first + insert-with-onConflictDoNothing
// contract wired against the uq_audio_sha256_wallet unique index in
// src/lib/schema.ts. The 5 cases cover the boundary matrix: baseline
// (deduped:false), idempotent retry (deduped:true), cross-artist
// collision (different wallets, same audio → both fresh), same-artist
// new track (different audio, same wallet → both fresh), and the
// concurrent double-click race (Promise.all → DB has 1 row, exactly
// one returns deduped:true, the other deduped:false).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { eq } from 'drizzle-orm';
import { initTestDb, getTestDb, resetTestDb } from '../helpers/db';
import {
  createSubmissionsService,
  SUBMISSION_MESSAGE,
} from '../../src/services/submissions';
import type { ArcAdapter } from '../../src/adapters/arc';
import {
  submissions as submissionsTable,
  users as usersTable,
} from '../../src/lib/schema';

// MODULAR: createSubmission emits 'submission-created' on a fresh
// insert (NOT on a dedup hit). Stubbing with vi.fn() so a future
// assertion could verify emission counts without re-mocking. The
// dedup tests below only check the lookup → insert contract, so
// the mock is the minimum surface.
vi.mock('@/lib/event-bus', () => ({
  emit: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  clearSubscriptions: vi.fn(),
}));

// MODULAR: point the production @/lib/db at the PGlite test fixture
// so createSubmission's insert/select calls don't try to hit the
// live Neon HTTP endpoint (which would ECONNREFUSED in the test
// process). The lazy `get db()` accessor means getTestDb() is
// resolved at FIRST USE, after beforeAll(initTestDb) has run —
// mirrors the pattern in tests/unit/x402.test.ts.
vi.mock('@/lib/db', () => ({
  get db() {
    return getTestDb();
  },
}));

// createSubmission never calls an arc method (only verifyPayment
// does), so the empty-stub cast is safe — TS sees ArcAdapter at the
// call site, runtime never invokes any method shape.
const stubArc: ArcAdapter = {} as ArcAdapter;

// Realistic-looking 64-char sha256 hex fixtures (32 bytes hex).
const SHA_AES = 'a'.repeat(64);
const SHA_BOB = 'b'.repeat(64);

async function signMessage(priv: `0x${string}`) {
  return privateKeyToAccount(priv).signMessage({ message: SUBMISSION_MESSAGE });
}

interface MakeArgsOverrides {
  audioSha256?: string | null;
}

function makeArgs(
  wallet: string,
  signature: string,
  overrides: MakeArgsOverrides = {},
) {
  return {
    audioPath: '/tmp/test.wav',
    contentType: 'audio/wav',
    sizeBytes: 1234,
    durationSeconds: 1,
    metadata: {
      title: 'Demo track',
      artistName: 'Demo Artist',
      versionType: 'demo' as const,
      genre: 'electronic',
      mood: 'demo',
    },
    artistWallet: wallet,
    signature,
    audioIpfsCid: null,
    audioSha256: overrides.audioSha256 ?? null,
  };
}

function makeSvc(platformWallet?: string) {
  return createSubmissionsService({ arc: stubArc, platformWallet });
}

const WALLET_A_PRIV = generatePrivateKey();
const WALLET_A = privateKeyToAccount(WALLET_A_PRIV).address;
const WALLET_B_PRIV = generatePrivateKey();
const WALLET_B = privateKeyToAccount(WALLET_B_PRIV).address;

describe('submissions dedup (service)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  // MODULAR: resetTestDb wipes every test table; the submissions
  // schema references users.wallet_address so we re-seed users per
  // case to keep the FK happy. (Other test files don't insert
  // submissions and so can skip this dance.)
  beforeEach(async () => {
    await resetTestDb();
    const db = getTestDb();
    await db.insert(usersTable).values([
      { id: 'user-a', walletAddress: WALLET_A, displayName: 'A' },
      { id: 'user-b', walletAddress: WALLET_B, displayName: 'B' },
    ]);
  });

  it('baseline: fresh audio + wallet → deduped:false + new id + sha256 stored', async () => {
    const sig = await signMessage(WALLET_A_PRIV);
    const r = await makeSvc().createSubmission({
      ...makeArgs(WALLET_A, sig, { audioSha256: SHA_AES }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deduped).toBe(false);
    expect(r.submission.audio_sha256).toBe(SHA_AES);
    expect(r.submission.artist_wallet).toBe(WALLET_A.toLowerCase());

    const db = getTestDb();
    const [row] = await db
      .select()
      .from(submissionsTable)
      .where(eq(submissionsTable.id, r.submission.id));
    expect(row?.audioSha256).toBe(SHA_AES);
  });

  it('idempotent retry: same audio + same wallet → deduped:true + same id', async () => {
    const sig = await signMessage(WALLET_A_PRIV);
    const svc = makeSvc();
    const first = await svc.createSubmission({
      ...makeArgs(WALLET_A, sig, { audioSha256: SHA_AES }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await svc.createSubmission({
      ...makeArgs(WALLET_A, sig, { audioSha256: SHA_AES }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduped).toBe(true);
    expect(second.submission.id).toBe(first.submission.id);

    const db = getTestDb();
    const rows = await db
      .select()
      .from(submissionsTable)
      .where(eq(submissionsTable.audioSha256, SHA_AES));
    expect(rows).toHaveLength(1);
  });

  it('cross-artist collision: same audio + different wallet → both fresh', async () => {
    const sigA = await signMessage(WALLET_A_PRIV);
    const sigB = await signMessage(WALLET_B_PRIV);
    const svc = makeSvc();
    const r1 = await svc.createSubmission({
      ...makeArgs(WALLET_A, sigA, { audioSha256: SHA_AES }),
    });
    const r2 = await svc.createSubmission({
      ...makeArgs(WALLET_B, sigB, { audioSha256: SHA_AES }),
    });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(false);
    expect(r2.submission.id).not.toBe(r1.submission.id);
  });

  it('same-artist, new track: different audio + same wallet → both fresh', async () => {
    const sig = await signMessage(WALLET_A_PRIV);
    const svc = makeSvc();
    const r1 = await svc.createSubmission({
      ...makeArgs(WALLET_A, sig, { audioSha256: SHA_AES }),
    });
    const r2 = await svc.createSubmission({
      ...makeArgs(WALLET_A, sig, { audioSha256: SHA_BOB }),
    });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(false);
    expect(r2.submission.id).not.toBe(r1.submission.id);
  });

  it('concurrent double-click race: Promise.all same payload → DB has 1 row, one deduped', async () => {
    const sig = await signMessage(WALLET_A_PRIV);
    const svc = makeSvc();
    const task = () =>
      svc.createSubmission({
        ...makeArgs(WALLET_A, sig, { audioSha256: SHA_AES }),
      });
    const [a, b] = await Promise.all([task(), task()]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    if (!a.ok || !b.ok) return;
    // MODULAR: one insert succeeds (deduped:false); the other sees
    // the unique-index conflict and re-fetches as deduped:true.
    // The order depends on which call's lookup-SELECT saw the
    // committed row first; sorting the booleans asserts the
    // "exactly one of each" contract.
    expect([a.deduped, b.deduped].sort()).toEqual([false, true]);
    expect(a.submission.id).toBe(b.submission.id);

    const db = getTestDb();
    const rows = await db
      .select()
      .from(submissionsTable)
      .where(eq(submissionsTable.audioSha256, SHA_AES));
    expect(rows).toHaveLength(1);
  });
});
