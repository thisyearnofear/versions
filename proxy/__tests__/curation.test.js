// MODULAR: Curation service integration tests. node:test, real ed25519
// signatures, isolated DB.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const nacl = require('tweetnacl');
const bs58 = require('bs58');

const TEST_DB = path.resolve(__dirname, '..', '..', 'data', 'test-curation.db');
process.env.DB_PATH = TEST_DB;

const { runMigrations } = require('../migrate');
const { openDb, closeDb } = require('../db');
const { createArcAdapter } = require('../adapters/arc');
const { createSubmissionsService } = require('../services/submissions');
const { createSettlementService } = require('../services/settlement');
const { createCurationService } = require('../services/curation');

const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);

let arc, submissions, settlement, curation;
let artist, curator1, curator2, curator3;
let submissionId;

function cleanDbFiles() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function sign(message, secretKey) {
  return Buffer.from(nacl.sign.detached(Buffer.from(message, 'utf8'), secretKey)).toString('base64');
}

function walletOf(keypair) {
  return bs58.encode(keypair.publicKey);
}

function makeRating(solo, vocal, energy, tempo, mood, notes) {
  return {
    solo_intensity: solo,
    vocal_quality: vocal,
    energy_vs_studio: energy,
    tempo_feel: tempo,
    mood_tags: mood,
    notes
  };
}

async function createVerifiedSubmission(artistKp) {
  const r = submissions.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    metadata: {
      title: 'Curation Test',
      artistName: 'Test Artist',
      versionType: 'demo',
      genre: 'Test',
      mood: 'Crisp'
    },
    artistWallet: walletOf(artistKp),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artistKp.secretKey)
  });
  assert.equal(r.ok, true);
  const id = r.submission.id;
  const v = await submissions.verifyPayment(id, '0x' + 'a'.repeat(64));
  assert.equal(v.ok, true);
  assert.equal(v.submission.status, 'awaiting_curation');
  return id;
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

  artist = nacl.sign.keyPair();
  curator1 = nacl.sign.keyPair();
  curator2 = nacl.sign.keyPair();
  curator3 = nacl.sign.keyPair();
});

after(() => {
  closeDb();
  cleanDbFiles();
});

// ---------- claim flow ----------

test('claim: artist cannot claim their own submission', async () => {
  submissionId = await createVerifiedSubmission(artist);
  const r = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_CLAIM', artist.secretKey)
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /artist/i);
});

test('claim: bad signature is rejected', async () => {
  const r = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: 'not-a-real-signature-padding-padding'
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /signature|decode/);
});

test('claim: curator with a different signature from a third key is rejected', async () => {
  const r = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator2.secretKey)
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /signature/);
});

test('claim: valid curator can claim', async () => {
  const r = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator1.secretKey)
  });
  assert.equal(r.ok, true);
  assert.ok(r.claim.id);
  assert.ok(r.claim.expires_at);
});

test('claim: same curator cannot double-claim while active', async () => {
  const r = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator1.secretKey)
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /active claim/i);
});

test('claim: rejected for unknown submission', async () => {
  const r = curation.claimSubmission({
    submissionId: 'nope',
    curatorWallet: walletOf(curator2),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator2.secretKey)
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Submission not found');
});

// ---------- rate flow ----------

test('rate: rejected when there is no claim', async () => {
  const r = curation.submitRating({
    submissionId,
    curatorWallet: walletOf(curator2),
    signature: sign('VERSIONS_LEPTON_RATE', curator2.secretKey),
    rating: makeRating(5, 5, 'same', 'locked', ['Bluesy'])
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /claim/i);
});

test('rate: invalid rating values are rejected', async () => {
  const r = curation.submitRating({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: sign('VERSIONS_LEPTON_RATE', curator1.secretKey),
    rating: makeRating(11, 5, 'same', 'locked', ['Bluesy'])  // solo > 10
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /solo_intensity/);
});

test('rate: valid rating is recorded, count increments, no publish yet', async () => {
  const r = curation.submitRating({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: sign('VERSIONS_LEPTON_RATE', curator1.secretKey),
    rating: makeRating(7, 8, 'higher', 'rushing', ['Bluesy', 'Raw'])
  });
  assert.equal(r.ok, true);
  assert.equal(r.rating_count, 1);
  assert.equal(r.published, null);
});

test('rate: same curator cannot rate twice', async () => {
  const r = curation.submitRating({
    submissionId,
    curatorWallet: walletOf(curator1),
    signature: sign('VERSIONS_LEPTON_RATE', curator1.secretKey),
    rating: makeRating(6, 6, 'same', 'locked', [])
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /already rated/i);
});

// ---------- publish gate ----------

test('rate: 2nd curator rates, still no publish', async () => {
  const claim2 = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(curator2),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator2.secretKey)
  });
  assert.equal(claim2.ok, true);

  const r = curation.submitRating({
    submissionId,
    curatorWallet: walletOf(curator2),
    signature: sign('VERSIONS_LEPTON_RATE', curator2.secretKey),
    rating: makeRating(9, 6, 'higher', 'locked', ['Euphoric'])
  });
  assert.equal(r.ok, true);
  assert.equal(r.rating_count, 2);
  assert.equal(r.published, null);
});

test('rate: 3rd curator rates → publish fires, version + legs created', async () => {
  const claim3 = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(curator3),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator3.secretKey)
  });
  assert.equal(claim3.ok, true);

  const r = curation.submitRating({
    submissionId,
    curatorWallet: walletOf(curator3),
    signature: sign('VERSIONS_LEPTON_RATE', curator3.secretKey),
    rating: makeRating(5, 7, 'same', 'rushing', ['Raw'])
  });
  assert.equal(r.ok, true);
  assert.equal(r.rating_count, 3);
  assert.ok(r.published);
  assert.equal(r.published.alreadyPublished, false);
  assert.ok(r.published.version);
  assert.ok(r.published.settlement_legs);

  // 5 legs: 3 curators + platform + musicbrainz
  assert.equal(r.published.settlement_legs.length, 5);

  // Index legs by (role, wallet). The platform and musicbrainz legs share
  // the same wallet on Day 4 (the MBID resolver is not wired yet), so
  // indexing by wallet alone would clobber one.
  const byKey = {};
  for (const leg of r.published.settlement_legs) byKey[`${leg.recipient_role}:${leg.recipient_wallet}`] = leg;
  const c1 = byKey[`curator:${walletOf(curator1)}`];
  const c2 = byKey[`curator:${walletOf(curator2)}`];
  const c3 = byKey[`curator:${walletOf(curator3)}`];
  const platform = byKey[`platform:${TEST_PLATFORM_WALLET}`];
  const musicbrainz = byKey[`musicbrainz:${TEST_PLATFORM_WALLET}`];

  // CLEAN: first-to-rate curator gets the +2 micro-USDC remainder so the
  // split reconciles to exactly 0.50. The settlement query orders by
  // (submitted_at, rowid) so the first-to-rate is deterministic.
  assert.ok(c1, 'curator1 should have a leg');
  assert.equal(c1.amount_usdc, '0.116668');
  assert.ok(c2, 'curator2 should have a leg');
  assert.equal(c2.amount_usdc, '0.116666');
  assert.ok(c3, 'curator3 should have a leg');
  assert.equal(c3.amount_usdc, '0.116666');
  assert.ok(platform, 'platform should have a leg');
  assert.equal(platform.amount_usdc, '0.1');
  assert.ok(musicbrainz, 'musicbrainz should have a leg');
  assert.equal(musicbrainz.amount_usdc, '0.05');

  // CLEAN: 3*0.116666 + 0.116668 + 0.1 + 0.05 = 0.5 (exact, no float drift)
  const total = r.published.settlement_legs.reduce(
    (a, l) => a + Number.parseFloat(l.amount_usdc),
    0
  );
  assert.ok(Math.abs(total - 0.5) < 1e-9, `legs should sum to 0.5, got ${total}`);

  // Aggregated taste graph
  const v = r.published.version;
  assert.equal(v.rating_count, 3);
  assert.equal(v.avg_solo_intensity, (7 + 9 + 5) / 3);
  assert.equal(v.avg_vocal_quality, (8 + 6 + 7) / 3);
  assert.equal(v.energy_consensus, 'higher');   // 2 of 3
  assert.equal(v.tempo_consensus, 'rushing');   // 2 of 3
  const tags = JSON.parse(v.aggregated_mood_tags);
  assert.deepEqual(tags, ['Bluesy', 'Euphoric', 'Raw']);

  // Submission flipped to published
  const db = openDb();
  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
  assert.equal(sub.status, 'published');
  assert.ok(sub.published_at);
  // CLEAN: don't close the shared connection here — every service holds a
  // reference to it; the after() hook handles teardown.
});

test('rate: 4th curator tries to rate a published submission and is rejected', async () => {
  const kp4 = nacl.sign.keyPair();
  const claim4 = curation.claimSubmission({
    submissionId,
    curatorWallet: walletOf(kp4),
    signature: sign('VERSIONS_LEPTON_CLAIM', kp4.secretKey)
  });
  assert.equal(claim4.ok, false);
  assert.match(claim4.error, /Cannot claim/i);
});

// ---------- profiles ----------

test('curator profile: reports count and recent ratings', () => {
  const c1 = walletOf(curator1);
  const profile = curation.getCuratorProfile(c1);
  assert.equal(profile.wallet, c1);
  assert.equal(profile.ratings_count, 1);
  assert.equal(profile.recent_ratings.length, 1);
  assert.equal(profile.recent_ratings[0].solo_intensity, 7);
});

test('artist profile: reports submission + published counts', () => {
  const a = walletOf(artist);
  const profile = curation.getArtistProfile(a);
  assert.equal(profile.wallet, a);
  assert.equal(profile.submissions_count, 1);
  assert.equal(profile.published_count, 1);
});
