// MODULAR: A&R service integration tests. node:test, isolated DB,
// full flow: submit → review → publish → generate playlists → play.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const nacl = require('tweetnacl');
const bs58 = require('bs58');

const TEST_DB = path.resolve(__dirname, '..', '..', 'data', 'test-ar.db');
process.env.DB_PATH = TEST_DB;

const { runMigrations } = require('../migrate');
const { openDb, closeDb } = require('../db');
const { createArcAdapter } = require('../adapters/arc');
const { createSubmissionsService } = require('../services/submissions');
const { createSettlementService } = require('../services/settlement');
const { createLlmAdapter } = require('../adapters/llm');
const { createAgentService } = require('../services/agents');
const { createArService } = require('../services/ar');

const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);
const TEST_AR_WALLET = 'ar_agent_test_wallet';
const AGENT_WALLETS = ['agent_prod_test', 'agent_perf_test', 'agent_market_test'];

let arc, submissions, settlement, llm, agents, ar;
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
  ar = createArService({ arc, settlement, arWallet: TEST_AR_WALLET });

  artist = nacl.sign.keyPair();
});

after(() => {
  closeDb();
  cleanDbFiles();
});

test('ar: create and publish a submission via agent review', async () => {
  const metadata = {
    title: 'AR Test Track',
    artistName: 'AR Artist',
    versionType: 'live',
    genre: 'rock',
    mood: 'energetic'
  };

  const result = submissions.createSubmission({
    audioPath: 'data/uploads/test-ar.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 512,
    durationSeconds: 180,
    metadata,
    artistWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artist.secretKey)
  });
  assert.ok(result.ok);
  submissionId = result.submission.id;

  await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
  const review = await agents.reviewSubmission(submissionId);
  assert.ok(review.ok);
  assert.ok(review.published);
});

test('ar: generate playlists from published versions', () => {
  const playlists = ar.generatePlaylists();
  assert.ok(playlists.length > 0, 'should generate at least one playlist');

  const rockPlaylist = playlists.find(p => p.genre === 'rock');
  assert.ok(rockPlaylist, 'should have a rock playlist');
  assert.ok(rockPlaylist.name.includes('rock') || rockPlaylist.name.length > 5);
  assert.equal(rockPlaylist.track_count, 1);
  assert.equal(rockPlaylist.ar_wallet, TEST_AR_WALLET);
});

test('ar: list playlists returns tracks', () => {
  const playlists = ar.listPlaylists();
  assert.ok(playlists.length > 0);

  const first = playlists[0];
  assert.ok(first.tracks);
  assert.ok(first.tracks.length > 0);
  assert.ok(first.tracks[0].title);
  assert.ok(first.tracks[0].artist_name);
});

test('ar: get playlist by id returns detail + tracks', () => {
  const playlists = ar.listPlaylists();
  const playlist = ar.getPlaylist(playlists[0].id);
  assert.ok(playlist);
  assert.ok(playlist.tracks.length > 0);
  assert.ok(playlist.tracks[0].artist_wallet);
});

test('ar: record play settles both legs', async () => {
  const playlists = ar.listPlaylists();
  const playlist = playlists[0];
  const track = playlist.tracks[0];
  const listenerWallet = 'listener_test_wallet_001';

  const result = await ar.recordPlay({
    playlistId: playlist.id,
    versionId: track.submission_id,
    listenerWallet
  });

  assert.ok(result.ok);
  assert.equal(result.play.status, 'settled');
  assert.equal(result.play.listener_fee_usdc, '0.001');
  assert.equal(result.play.artist_payout_usdc, '0.0005');
  assert.ok(result.play.listener_tx_hash);
  assert.ok(result.play.artist_tx_hash);
  assert.equal(result.play.listener_wallet, listenerWallet);
  assert.equal(result.play.artist_wallet, track.artist_wallet);
});

test('ar: playlist stats reflect play events', async () => {
  const playlists = ar.listPlaylists();
  const playlist = playlists[0];
  const stats = ar.getPlaylistStats(playlist.id);

  assert.ok(stats.total_plays >= 1);
  assert.ok(stats.total_revenue_usdc > 0);
  assert.ok(stats.total_paid_to_artists_usdc > 0);
  assert.ok(stats.ar_margin_usdc > 0);
});

test('ar: rejects play on non-existent playlist', async () => {
  const result = await ar.recordPlay({
    playlistId: 'non-existent',
    versionId: submissionId,
    listenerWallet: 'test'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Playlist not found');
});

test('ar: rejects play on non-existent version', async () => {
  const playlists = ar.listPlaylists();
  const result = await ar.recordPlay({
    playlistId: playlists[0].id,
    versionId: 'non-existent',
    listenerWallet: 'test'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Version not found');
});

test('ar: multiple plays accumulate stats', async () => {
  const playlists = ar.listPlaylists();
  const playlist = playlists[0];
  const track = playlist.tracks[0];

  for (let i = 0; i < 3; i++) {
    const result = await ar.recordPlay({
      playlistId: playlist.id,
      versionId: track.submission_id,
      listenerWallet: `listener_multi_${i}`
    });
    assert.ok(result.ok);
  }

  const stats = ar.getPlaylistStats(playlist.id);
  assert.ok(stats.total_plays >= 4);
});
