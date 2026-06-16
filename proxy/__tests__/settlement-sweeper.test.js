// MODULAR: settlement sweeper tests. The sweeper picks up 'pending'
// legs older than 30s and retries them via settlement.settleLegsAsync.
// This test stubs the settlement service with a fake that records
// every call.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const TEST_DB = path.resolve(__dirname, '..', '..', 'data', 'test-sweeper.db');
process.env.DB_PATH = TEST_DB;

const { runMigrations } = require('../migrate');
const { openDb, closeDb } = require('../db');
const { createSweeper, findStuckLegs } = require('../services/settlement-sweeper');

function cleanDbFiles() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function seedSubmission(db, subId) {
  // MODULAR: settlement_legs has a FK to submissions, so a leg
  // can't be inserted without its parent submission. The submission
  // row also needs the NOT NULL fields (audio_size_bytes, etc).
  db.prepare(`
    INSERT INTO submissions
      (id, artist_wallet, audio_path, audio_size_bytes, content_type, fee_quote_usdc,
       title, artist_name, version_type, status, payment_tx_hash, payment_verified_at, submitted_at)
    VALUES
      (@id, 'wallet-test', 'audio-test', 0, 'audio/mpeg', '0.50',
       'Test', 'Tester', 'demo', 'published', '0xtest', datetime('now'), datetime('now'))
  `).run({ id: subId });
}

function seedPendingLeg(db, legId, ageSeconds, subId) {
  // MODULAR: insert a row with a created_at backdated by `ageSeconds`.
  db.prepare(`
    INSERT INTO settlement_legs
      (id, submission_id, recipient_wallet, recipient_role, amount_usdc, status, created_at)
    VALUES
      (@id, @sub, @wallet, 'curator', '0.10', 'pending', datetime('now', @age))
  `).run({
    id: legId, sub: subId, wallet: 'wallet-' + legId,
    age: '-' + ageSeconds + ' seconds'
  });
}

test('findStuckLegs: returns only legs older than 30s', () => {
  cleanDbFiles();
  const db = openDb();
  runMigrations(db);
  seedSubmission(db, 'sub-findstuck');
  seedPendingLeg(db, 'old-1', 60, 'sub-findstuck');
  seedPendingLeg(db, 'old-2', 45, 'sub-findstuck');
  seedPendingLeg(db, 'fresh', 5, 'sub-findstuck');
  const stuck = findStuckLegs(db, Date.now());
  assert.equal(stuck.length, 2, 'only the 2 old legs are stuck');
  const ids = stuck.map((l) => l.id).sort();
  assert.deepEqual(ids, ['old-1', 'old-2']);
  closeDb();
  cleanDbFiles();
});

test('sweeper.tick: retries stuck legs via settlement.settleLegsAsync', async () => {
  cleanDbFiles();
  const db = openDb();
  runMigrations(db);
  seedSubmission(db, 'sub-retry');
  seedPendingLeg(db, 'stuck-1', 60, 'sub-retry');
  seedPendingLeg(db, 'stuck-2', 60, 'sub-retry');

  const settleCalls = [];
  const fakeSettlement = {
    async settleLegsAsync(legIds) {
      settleCalls.push(legIds);
      return legIds.map((id) => ({ leg_id: id, status: 'settled', tx_hash: '0xmock' }));
    }
  };
  const sweeper = createSweeper({ db, settlement: fakeSettlement });
  await sweeper.tick();
  assert.equal(settleCalls.length, 1, 'settlement called once');
  assert.deepEqual(settleCalls[0].sort(), ['stuck-1', 'stuck-2']);
  // CLEAN: the sweeper stats are populated.
  const s = sweeper.stats();
  assert.equal(s.last_run_stats.retried, 2);
  assert.equal(s.last_run_stats.settled, 2);
  assert.equal(s.last_run_stats.failed, 0);
  closeDb();
  cleanDbFiles();
});

test('sweeper.tick: no stuck legs → noop, stats still recorded', async () => {
  cleanDbFiles();
  const db = openDb();
  runMigrations(db);
  const settleCalls = [];
  const fakeSettlement = { async settleLegsAsync(ids) { settleCalls.push(ids); return []; } };
  const sweeper = createSweeper({ db, settlement: fakeSettlement });
  await sweeper.tick();
  assert.equal(settleCalls.length, 0);
  const s = sweeper.stats();
  assert.equal(s.last_run_stats.retried, 0);
  closeDb();
  cleanDbFiles();
});

test('sweeper.tick: records failures from settlement', async () => {
  cleanDbFiles();
  const db = openDb();
  runMigrations(db);
  seedSubmission(db, 'sub-fail');
  seedPendingLeg(db, 'stuck-fail', 60, 'sub-fail');
  const fakeSettlement = {
    async settleLegsAsync(ids) {
      return ids.map((id) => ({ leg_id: id, status: 'failed', error: 'arc unreachable' }));
    }
  };
  const sweeper = createSweeper({ db, settlement: fakeSettlement });
  await sweeper.tick();
  const s = sweeper.stats();
  assert.equal(s.last_run_stats.failed, 1);
  assert.equal(s.last_run_stats.settled, 0);
  closeDb();
  cleanDbFiles();
});
