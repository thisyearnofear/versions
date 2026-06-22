// MODULAR: Agent service integration tests. node:test, isolated DB,
// mock LLM, full flow: submit → pay → agent review → publish.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const nacl = require('tweetnacl');
const bs58 = require('bs58');

const TEST_DB = path.resolve(__dirname, '..', '..', 'data', 'test-agents.db');
process.env.DB_PATH = TEST_DB;

const { runMigrations } = require('../migrate');
const { openDb, closeDb } = require('../db');
const { createArcAdapter } = require('../adapters/arc');
const { createSubmissionsService } = require('../services/submissions');
const { createSettlementService } = require('../services/settlement');
const { createLlmAdapter } = require('../adapters/llm');
const { createAgentService } = require('../services/agents');

const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);
const AGENT_WALLETS = ['agent_prod_test', 'agent_perf_test', 'agent_market_test'];

let arc, submissions, settlement, llm, agents;
let artist;
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

before(() => {
  cleanDbFiles();
  runMigrations(openDb());

  arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  llm = createLlmAdapter({});
  agents = createAgentService({ llm, settlement, agentWallets: AGENT_WALLETS });

  artist = nacl.sign.keyPair();
});

after(() => {
  closeDb();
  cleanDbFiles();
});

test('agent review: creates a submission, verifies payment, then reviewed by agents', async () => {
  const audioBuffer = Buffer.alloc(1024, 0xff);
  const metadata = {
    title: 'Test Track for Agents',
    artistName: 'Test Artist',
    versionType: 'live',
    genre: 'rock',
    mood: 'energetic',
    description: 'A live rock performance'
  };

  const result = submissions.createSubmission({
    audioPath: 'data/uploads/test-agents.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: audioBuffer.length,
    durationSeconds: 180,
    metadata,
    artistWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artist.secretKey)
  });

  assert.ok(result.ok);
  submissionId = result.submission.id;

  const verified = await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
  assert.ok(verified.ok);
  assert.equal(verified.submission.status, 'awaiting_curation');
});

test('agent review: full pipeline produces 3 reviews + brief + publish', async () => {
  const result = await agents.reviewSubmission(submissionId);

  assert.ok(result.ok);
  assert.equal(result.reviews.length, 3);
  assert.ok(result.brief, 'market agent should produce a placement brief');
  assert.equal(result.rating_count, 3);
  assert.ok(result.published, 'should auto-publish at threshold of 3');

  const agents_ = result.reviews.map(r => r.agent_name).sort();
  assert.deepEqual(agents_, ['market', 'performance', 'production']);

  for (const review of result.reviews) {
    assert.ok(review.solo_intensity >= 1 && review.solo_intensity <= 10);
    assert.ok(review.vocal_quality >= 1 && review.vocal_quality <= 10);
    assert.ok(['lower', 'same', 'higher'].includes(review.energy_vs_studio));
    assert.ok(['dragging', 'locked', 'rushing'].includes(review.tempo_feel));
    assert.ok(Array.isArray(review.mood_tags));
    assert.ok(typeof review.notes === 'string');
    assert.equal(review.mock, true);
  }

  assert.ok(result.brief.venues.length > 0);
  assert.ok(result.brief.youtube_channels.length > 0);
  assert.ok(result.brief.influencers.length > 0);
  assert.ok(result.brief.draft_emails.length > 0);
  assert.ok(typeof result.brief.audience_summary === 'string');
});

test('agent review: published version has correct taste-graph', () => {
  const db = openDb();
  const pv = db.prepare('SELECT * FROM published_versions WHERE submission_id = ?').get(submissionId);
  assert.ok(pv);
  assert.ok(pv.avg_solo_intensity > 0);
  assert.ok(pv.avg_vocal_quality > 0);
  assert.ok(['lower', 'same', 'higher'].includes(pv.energy_consensus));
  assert.ok(['dragging', 'locked', 'rushing'].includes(pv.tempo_consensus));
  assert.equal(pv.rating_count, 3);
});

test('agent review: settlement legs created for agent wallets', () => {
  const legs = settlement.getLegsForSubmission(submissionId);
  assert.ok(legs.length >= 4);

  const curatorLegs = legs.filter(l => l.recipient_role === 'curator');
  assert.equal(curatorLegs.length, 3);

  for (const wallet of AGENT_WALLETS) {
    const leg = curatorLegs.find(l => l.recipient_wallet === wallet);
    assert.ok(leg, `agent wallet ${wallet} should have a settlement leg`);
    assert.equal(leg.status, 'settled');
  }
});

test('agent review: getReviews returns stored reviews', () => {
  const reviews = agents.getReviews(submissionId);
  assert.equal(reviews.length, 3);
  assert.ok(reviews[0].raw_response);
});

test('agent review: getBrief returns stored brief', () => {
  const brief = agents.getBrief(submissionId);
  assert.ok(brief);
  assert.ok(brief.venues.length > 0);
  assert.ok(brief.draft_emails.length > 0);
});

test('agent review: rejects already published submission', async () => {
  const result = await agents.reviewSubmission(submissionId);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Submission already published');
});

test('agent review: rejects non-existent submission', async () => {
  const result = await agents.reviewSubmission('non-existent-id');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Submission not found');
});

test('agent review: ratings table populated alongside agent_reviews', () => {
  const db = openDb();
  const ratings = db.prepare('SELECT * FROM ratings WHERE submission_id = ?').all(submissionId);
  assert.equal(ratings.length, 3);

  for (const wallet of AGENT_WALLETS) {
    const rating = ratings.find(r => r.curator_wallet === wallet);
    assert.ok(rating, `agent wallet ${wallet} should have a rating in the ratings table`);
  }
});
