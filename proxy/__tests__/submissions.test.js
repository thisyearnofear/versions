// MODULAR: Submissions service unit tests. node:test, no extra deps.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const nacl = require('tweetnacl');
const bs58 = require('bs58');

const TEST_DB = path.resolve(__dirname, '..', '..', 'data', 'test-submissions.db');
process.env.DB_PATH = TEST_DB;

const { runMigrations } = require('../migrate');
const { openDb, closeDb } = require('../db');
const { createArcAdapter } = require('../adapters/arc');
const { createSubmissionsService } = require('../services/submissions');
const {
  validateSubmissionMetadata,
  validateArcTxHash
} = require('../runtime/validation');

const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);

let arc;
let service;
let keypair;

function cleanDbFiles() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function signSubmissionMessage(secretKey) {
  const message = Buffer.from('VERSIONS_LEPTON_SUBMIT', 'utf8');
  return Buffer.from(nacl.sign.detached(message, secretKey)).toString('base64');
}

function walletFor(publicKey) {
  return bs58.encode(publicKey);
}

function goodMetadata() {
  return {
    title: 'Acoustic Demo',
    artistName: 'Jane Doe',
    versionType: 'demo',
    genre: 'Folk',
    mood: 'Intimate',
    description: 'Recorded in a bedroom, 3am.'
  };
}

before(() => {
  cleanDbFiles();
  closeDb();  // ensure fresh handle
  const db = openDb();
  runMigrations(db);
  closeDb();

  arc = createArcAdapter({
    rpcUrl: null,
    usdcContract: null,
    platformWallet: TEST_PLATFORM_WALLET
  });
  service = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  keypair = nacl.sign.keyPair();
});

after(() => {
  closeDb();
  cleanDbFiles();
});

// ---------- validation ----------

test('validateSubmissionMetadata: accepts well-formed input', () => {
  const r = validateSubmissionMetadata(goodMetadata());
  assert.equal(r.ok, true);
});

test('validateSubmissionMetadata: rejects missing title', () => {
  const r = validateSubmissionMetadata({ ...goodMetadata(), title: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('title')));
});

test('validateSubmissionMetadata: rejects bad versionType', () => {
  const r = validateSubmissionMetadata({ ...goodMetadata(), versionType: 'spicy' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('versionType')));
});

test('validateSubmissionMetadata: rejects bad MBID', () => {
  const r = validateSubmissionMetadata({ ...goodMetadata(), musicbrainzId: 'not-a-mbid' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('musicbrainzId')));
});

test('validateArcTxHash: accepts 0x + 64 hex', () => {
  const h = '0x' + '1'.repeat(64);
  assert.equal(validateArcTxHash(h), null);
});

test('validateArcTxHash: rejects bare hex', () => {
  const h = '1'.repeat(64);
  assert.match(validateArcTxHash(h), /0x-prefixed/);
});

// ---------- createSubmission ----------

test('createSubmission: valid input returns row with status=pending_payment', () => {
  const wallet = walletFor(keypair.publicKey);
  const sig = signSubmissionMessage(keypair.secretKey);
  const r = service.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    durationSeconds: 180,
    metadata: goodMetadata(),
    artistWallet: wallet,
    signature: sig
  });
  assert.equal(r.ok, true);
  assert.equal(r.submission.status, 'pending_payment');
  assert.equal(r.submission.fee_quote_usdc, '0.50');
  assert.equal(r.submission.artist_wallet, wallet);
  assert.equal(r.submission.audio_size_bytes, 1024);
});

test('createSubmission: rejects bad signature', () => {
  const wallet = walletFor(keypair.publicKey);
  const r = service.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    metadata: goodMetadata(),
    artistWallet: wallet,
    signature: 'not-a-real-signature-just-some-base64-padding-padding'
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /signature|decode/);
});

test('createSubmission: rejects signature from a different key', () => {
  const walletA = walletFor(keypair.publicKey);
  const other = nacl.sign.keyPair();
  const sigFromOther = signSubmissionMessage(other.secretKey);
  const r = service.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    metadata: goodMetadata(),
    artistWallet: walletA,
    signature: sigFromOther
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /signature/);
});

// ---------- getSubmission / listQueue ----------

test('getSubmission: returns null for unknown id', () => {
  assert.equal(service.getSubmission('nope'), null);
});

test('getSubmission: returns the row with empty ratings/legs', () => {
  const wallet = walletFor(keypair.publicKey);
  const sig = signSubmissionMessage(keypair.secretKey);
  const created = service.createSubmission({
    audioPath: 'data/uploads/get.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 2048,
    metadata: goodMetadata(),
    artistWallet: wallet,
    signature: sig
  });
  const got = service.getSubmission(created.submission.id);
  assert.ok(got);
  assert.equal(got.id, created.submission.id);
  assert.deepEqual(got.ratings, []);
  assert.deepEqual(got.settlement_legs, []);
});

test('listQueue: empty when nothing is awaiting_curation', () => {
  // No submissions have been verified in this test run yet.
  const q = service.listQueue({ limit: 50 });
  assert.ok(Array.isArray(q));
  for (const row of q) {
    assert.ok(['awaiting_curation', 'in_curation'].includes(row.status));
  }
});

// ---------- verifyPayment ----------

test('verifyPayment: mock Arc flips status to awaiting_curation', async () => {
  const wallet = walletFor(keypair.publicKey);
  const sig = signSubmissionMessage(keypair.secretKey);
  const created = service.createSubmission({
    audioPath: 'data/uploads/pay.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 4096,
    metadata: goodMetadata(),
    artistWallet: wallet,
    signature: sig
  });
  const fakeTxHash = '0x' + 'b'.repeat(64);
  const r = await service.verifyPayment(created.submission.id, fakeTxHash);
  assert.equal(r.ok, true);
  assert.equal(r.submission.status, 'awaiting_curation');
  assert.equal(r.submission.payment_tx_hash, fakeTxHash);
  assert.ok(r.submission.payment_verified_at);
});

test('verifyPayment: rejects when submission is not pending_payment', async () => {
  const wallet = walletFor(keypair.publicKey);
  const sig = signSubmissionMessage(keypair.secretKey);
  const created = service.createSubmission({
    audioPath: 'data/uploads/pay2.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    metadata: goodMetadata(),
    artistWallet: wallet,
    signature: sig
  });
  const fakeTxHash = '0x' + 'c'.repeat(64);
  await service.verifyPayment(created.submission.id, fakeTxHash);
  // Second call should be rejected because status is no longer pending_payment.
  const r2 = await service.verifyPayment(created.submission.id, fakeTxHash);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /Cannot verify payment/);
});

test('verifyPayment: rejects unknown submission id', async () => {
  const r = await service.verifyPayment('nope', '0x' + 'd'.repeat(64));
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});
