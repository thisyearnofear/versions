// MODULAR: settlement sweeper tests. Uses a fake settlement service; no arc.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { initTestDb, getTestDb, resetTestDb, closeTestDb } from '../helpers/db';
import { vi } from 'vitest';
vi.mock('@/lib/db', () => ({
  get db() { return getTestDb(); },
}));
import { TEST_IDS, TEST_PLATFORM_WALLET } from '../helpers/fixtures';
import { submissions as submissionsTable, settlementLegs as legsTable } from '../../src/lib/schema';
import { createSweeper, findStuckLegs, STUCK_THRESHOLD_MS } from '../../src/services/settlement-sweeper';

async function seedSubmission(subId: string) {
  const db = getTestDb();
  await db.insert(submissionsTable).values({
    id: subId,
    artistWallet: TEST_IDS.artistWallet,
    audioPath: 'audio-test',
    audioSizeBytes: 0,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title: 'Test',
    artistName: 'Tester',
    versionType: 'demo',
    status: 'published',
    paymentTxHash: '0xtest',
    paymentVerifiedAt: new Date(),
  });
}

async function seedPendingLeg(legId: string, ageSeconds: number, subId: string) {
  const db = getTestDb();
  await db.insert(legsTable).values({
    id: legId,
    submissionId: subId,
    recipientWallet: 'wallet-' + legId,
    recipientRole: 'curator',
    amountUsdc: '0.10',
    status: 'pending',
    createdAt: new Date(Date.now() - ageSeconds * 1000),
  });
}

describe('settlement sweeper', () => {
  beforeEach(async () => {
    await initTestDb();
    await resetTestDb();
  });

  it('findStuckLegs returns only legs older than threshold', async () => {
    await seedSubmission('sub-findstuck');
    await seedPendingLeg('old-1', 60, 'sub-findstuck');
    await seedPendingLeg('old-2', 45, 'sub-findstuck');
    await seedPendingLeg('fresh', 5, 'sub-findstuck');
    const stuck = await findStuckLegs();
    expect(stuck.length).toBe(2);
    const ids = stuck.map((l) => l.id).sort();
    expect(ids).toEqual(['old-1', 'old-2']);
  });

  it('tick() retries stuck legs via settlement.settleLegsAsync', async () => {
    await seedSubmission('sub-retry');
    await seedPendingLeg('stuck-1', 60, 'sub-retry');
    await seedPendingLeg('stuck-2', 60, 'sub-retry');

    const calls: string[][] = [];
    const fakeSettlement = {
      async settleLegsAsync(legIds: string[]) {
        calls.push(legIds);
        return legIds.map((id) => ({ leg_id: id, status: 'settled', tx_hash: '0xmock' }));
      },
    };
    const sweeper = createSweeper({ settlement: fakeSettlement });
    await sweeper.tick();
    expect(calls.length).toBe(1);
    expect(calls[0].sort()).toEqual(['stuck-1', 'stuck-2']);
    const s = sweeper.stats();
    expect(s.last_run_stats?.retried).toBe(2);
    expect(s.last_run_stats?.settled).toBe(2);
    expect(s.last_run_stats?.failed).toBe(0);
  });

  it('tick() with no stuck legs is a noop', async () => {
    const calls: string[][] = [];
    const fakeSettlement = {
      async settleLegsAsync(ids: string[]) {
        calls.push(ids);
        return [];
      },
    };
    const sweeper = createSweeper({ settlement: fakeSettlement });
    await sweeper.tick();
    expect(calls.length).toBe(0);
    const s = sweeper.stats();
    expect(s.last_run_stats?.retried).toBe(0);
  });

  it('tick() records failures from settlement', async () => {
    await seedSubmission('sub-fail');
    await seedPendingLeg('stuck-fail', 60, 'sub-fail');
    const fakeSettlement = {
      async settleLegsAsync(ids: string[]) {
        return ids.map((id) => ({ leg_id: id, status: 'failed', error: 'arc unreachable' }));
      },
    };
    const sweeper = createSweeper({ settlement: fakeSettlement });
    await sweeper.tick();
    const s = sweeper.stats();
    expect(s.last_run_stats?.failed).toBe(1);
    expect(s.last_run_stats?.settled).toBe(0);
  });

  it('exports a sane threshold', () => {
    expect(STUCK_THRESHOLD_MS).toBe(30_000);
  });
});

describe('cleanup', () => {
  it('closes test DB', async () => {
    await closeTestDb();
  });
});

// Reference eq to avoid unused-import errors in strict configs
void eq;
