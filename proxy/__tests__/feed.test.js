// MODULAR: Feed service unit tests. Pure read code, isolated DB.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const TEST_DB = path.resolve(__dirname, '..', '..', 'data', 'test-feed.db');
process.env.DB_PATH = TEST_DB;

const { runMigrations } = require('../migrate');
const { openDb, closeDb } = require('../db');
const { createArcAdapter } = require('../adapters/arc');
const { createSubmissionsService } = require('../services/submissions');
const { createSettlementService } = require('../services/settlement');
const { createCurationService } = require('../services/curation');
const { createFeedService } = require('../services/feed');

const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);

let arc, submissions, settlement, curation, feed;
let artist, c1, c2, c3;

function cleanDbFiles() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function sign(message, secretKey) {
  return Buffer.from(nacl.sign.detached(Buffer.from(message, 'utf8'), secretKey)).toString('base64');
}
function walletOf(kp) { return bs58.encode(kp.publicKey); }

function goodMetadata(over) {
  return { title: 'Feed Test', artistName: 'Test', versionType: 'demo', genre: 'Test', ...over };
}
function goodRating(solo, vocal, energy, tempo, mood) {
  return { solo_intensity: solo, vocal_quality: vocal, energy_vs_studio: energy, tempo_feel: tempo, mood_tags: mood, notes: null };
}

async function publishOne(overrides = {}) {
  const kp1 = nacl.sign.keyPair();
  const kp2 = nacl.sign.keyPair();
  const kp3 = nacl.sign.keyPair();
  const r = submissions.createSubmission({
    audioPath: 'data/uploads/x.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1,
    metadata: goodMetadata(overrides.metadata || {}),
    artistWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artist.secretKey)
  });
  const id = r.submission.id;
  await submissions.verifyPayment(id, '0x' + 'a'.repeat(64));

  const claim1 = await (async () => curation.claimSubmission({
    submissionId: id, curatorWallet: walletOf(kp1),
    signature: sign('VERSIONS_LEPTON_CLAIM', kp1.secretKey)
  }))();
  assert.equal(claim1.ok, true);
  const rate1 = await curation.submitRating({
    submissionId: id, curatorWallet: walletOf(kp1),
    signature: sign('VERSIONS_LEPTON_RATE', kp1.secretKey),
    rating: overrides.r1 || goodRating(7, 8, 'higher', 'rushing', ['Bluesy', 'Raw'])
  });
  assert.equal(rate1.ok, true);

  const claim2 = curation.claimSubmission({
    submissionId: id, curatorWallet: walletOf(kp2),
    signature: sign('VERSIONS_LEPTON_CLAIM', kp2.secretKey)
  });
  assert.equal(claim2.ok, true);
  const rate2 = await curation.submitRating({
    submissionId: id, curatorWallet: walletOf(kp2),
    signature: sign('VERSIONS_LEPTON_RATE', kp2.secretKey),
    rating: overrides.r2 || goodRating(8, 7, 'higher', 'locked', ['Euphoric'])
  });
  assert.equal(rate2.ok, true);

  const claim3 = curation.claimSubmission({
    submissionId: id, curatorWallet: walletOf(kp3),
    signature: sign('VERSIONS_LEPTON_CLAIM', kp3.secretKey)
  });
  assert.equal(claim3.ok, true);
  const rate3 = await curation.submitRating({
    submissionId: id, curatorWallet: walletOf(kp3),
    signature: sign('VERSIONS_LEPTON_RATE', kp3.secretKey),
    rating: overrides.r3 || goodRating(6, 6, 'same', 'rushing', ['Raw'])
  });
  assert.equal(rate3.ok, true);
  return { id, rate3 };
}

before(() => {
  cleanDbFiles();
  closeDb();
  const db = openDb();
  runMigrations(db);
  closeDb();

  arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  curation = createCurationService({ settlement });
  feed = createFeedService();

  artist = nacl.sign.keyPair();
});

after(() => {
  closeDb();
  cleanDbFiles();
});

// ---------- listPublished ----------

test('listPublished: empty when nothing is published', () => {
  const r = feed.listPublished();
  assert.equal(r.total, 0);
  assert.deepEqual(r.rows, []);
});

test('listPublished: returns the published version with all settled legs', async () => {
  const { id } = await publishOne({ metadata: { title: 'V1', versionType: 'demo' } });
  const r = feed.listPublished();
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].submission_id, id);
  assert.equal(r.rows[0].energy_consensus, 'higher');   // 2 of 3
  assert.equal(r.rows[0].tempo_consensus, 'rushing');   // 2 of 3
});

test('listPublished: filter by mood', async () => {
  // Add a second version that should NOT match "Bluesy" tag.
  await publishOne({ metadata: { title: 'V2', versionType: 'acoustic' }, r1: goodRating(4, 4, 'lower', 'dragging', ['Acoustic']) });
  const r = feed.listPublished({ mood: 'Bluesy' });
  assert.equal(r.total, 1);
  assert.match(r.rows[0].title, /^V1/);
});

test('listPublished: filter by energy', async () => {
  const r = feed.listPublished({ energy: 'higher' });
  for (const row of r.rows) assert.equal(row.energy_consensus, 'higher');
});

test('listPublished: filter by tempo', async () => {
  const r = feed.listPublished({ tempo: 'rushing' });
  for (const row of r.rows) assert.equal(row.tempo_consensus, 'rushing');
});

test('listPublished: filter by minSolo / maxSolo', async () => {
  const r1 = feed.listPublished({ minSolo: 7 });
  for (const row of r1.rows) assert.ok(row.avg_solo_intensity >= 7);
  const r2 = feed.listPublished({ maxSolo: 6 });
  for (const row of r2.rows) assert.ok(row.avg_solo_intensity <= 6);
});

test('listPublished: filter by artist wallet', async () => {
  // Publish one more so the previous tests' V1 and V2 plus this one give 3.
  await publishOne({ metadata: { title: 'V3', versionType: 'remix' } });
  const r = feed.listPublished({ artistWallet: walletOf(artist) });
  assert.ok(r.total >= 3, `expected >= 3, got ${r.total}`);
  for (const row of r.rows) assert.equal(row.artist_wallet, walletOf(artist));
});

test('listPublished: invalid filter values are ignored', () => {
  const r = feed.listPublished({ energy: 'WAT', tempo: 'fast' });
  assert.ok(r.total >= 3, `expected >= 3 unfiltered, got ${r.total}`);
});

test('listPublished: pagination (limit + offset)', () => {
  const page1 = feed.listPublished({ limit: 2, offset: 0 });
  assert.equal(page1.rows.length, 2);
  const page2 = feed.listPublished({ limit: 2, offset: 2 });
  assert.equal(page2.rows.length, Math.min(1, page2.total - 2));
  // No overlap between pages
  const ids1 = new Set(page1.rows.map((r) => r.submission_id));
  for (const row of page2.rows) assert.ok(!ids1.has(row.submission_id));
});

test('listPublished: limit is capped at MAX_LIMIT (100)', () => {
  const r = feed.listPublished({ limit: 9999 });
  assert.ok(r.limit <= 100);
});

// ---------- getVersion ----------

test('getVersion: returns null for unknown id', () => {
  assert.equal(feed.getVersion('nope'), null);
});

test('getVersion: returns version + 5 settled legs', async () => {
  const { id, rate3 } = await publishOne({ metadata: { title: 'DetailTest' } });
  const r = feed.getVersion(id);
  assert.ok(r);
  assert.equal(r.version.submission_id, id);
  assert.equal(r.version.title, 'DetailTest');
  assert.equal(r.settlement_legs.length, 5);
  // CLEAN: every leg has a tx_hash and status='settled' (mock arc).
  for (const leg of r.settlement_legs) {
    assert.ok(leg.tx_hash, 'leg should have a tx_hash from settleLegsAsync');
    assert.equal(leg.status, 'settled', 'leg should be settled');
    assert.ok(leg.settled_at, 'leg should have a settled_at');
  }
  // 3 curator + 1 platform + 1 musicbrainz. Use rate3's settle_results
  // to find the first-to-rate curator (the one with the +2u remainder).
  const settleMap = new Map(rate3.published.settle_results.map((sr) => [sr.leg_id, sr]));
  const byKey = {};
  for (const leg of r.settlement_legs) byKey[`${leg.recipient_role}:${leg.recipient_wallet}`] = leg;
  // CLEAN: every curator leg has a tx_hash from arc.sendTransfer (mock)
  const curatorLegs = r.settlement_legs.filter((l) => l.recipient_role === 'curator');
  assert.equal(curatorLegs.length, 3);
  const totalCurator = curatorLegs.reduce((a, l) => a + Number.parseFloat(l.amount_usdc), 0);
  assert.ok(Math.abs(totalCurator - 0.35) < 1e-9, `curator legs should sum to 0.35, got ${totalCurator}`);
  // Total across all roles must equal exactly 0.5.
  const total = r.settlement_legs.reduce((a, l) => a + Number.parseFloat(l.amount_usdc), 0);
  assert.ok(Math.abs(total - 0.5) < 1e-9, `legs should sum to 0.5, got ${total}`);
  // All settle_results are settled.
  for (const sr of rate3.published.settle_results) {
    assert.equal(sr.status, 'settled', `leg ${sr.leg_id} should be settled`);
    assert.ok(sr.tx_hash);
  }
});
