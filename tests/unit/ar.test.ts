// MODULAR: A&R service tests. submit → review → publish → playlists → play.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSubmissionsService } = await import('../../src/services/submissions');
const { createSettlementService } = await import('../../src/services/settlement');
const { createLlmAdapter } = await import('../../src/adapters/llm');
const { createAgentService } = await import('../../src/services/agents');
const { createArService } = await import('../../src/services/ar');
const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');

const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;
const TEST_AR_WALLET = TEST_ADDRESSES.acc1;
const AGENT_WALLETS = [TEST_ADDRESSES.acc2, TEST_ADDRESSES.acc3, '0x' + 'b'.repeat(40)];

let submissions: ReturnType<typeof createSubmissionsService>;
let settlement: ReturnType<typeof createSettlementService>;
let llm: ReturnType<typeof createLlmAdapter>;
let agents: ReturnType<typeof createAgentService>;
let ar: ReturnType<typeof createArService>;
let submissionId: string;

beforeAll(async () => {
  await _initTestDb();
  const arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  llm = createLlmAdapter({});
  agents = createAgentService({ llm, settlement, agentWallets: AGENT_WALLETS });
  ar = createArService({ arc, arWallet: TEST_AR_WALLET });
});

beforeEach(async () => {
  await _resetTestDb();
  const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
  const r = await submissions.createSubmission({
    audioPath: 'data/uploads/test-ar.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    durationSeconds: 180,
    metadata: {
      title: 'AR Test',
      artistName: 'AR Artist',
      versionType: 'live',
      genre: 'rock',
      mood: 'energetic',
    },
    artistWallet: TEST_ADDRESSES.acc1,
    signature: sig,
  });
  if (!r.ok) throw new Error('setup failed: ' + r.error);
  submissionId = r.submission.id;
  await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
  const review = await agents.reviewSubmission(submissionId);
  if (!review.ok) throw new Error('review failed: ' + review.error);
});

describe('ar: playlists', () => {
  it('generatePlaylists creates at least one playlist', async () => {
    const playlists = await ar.generatePlaylists();
    expect(playlists.length).toBeGreaterThan(0);
    const rock = playlists.find((p) => p.genre === 'rock');
    expect(rock).toBeDefined();
    expect(rock!.ar_wallet).toBe(TEST_AR_WALLET);
  });

  it('listPlaylists returns tracks', async () => {
    await ar.generatePlaylists();
    const playlists = await ar.listPlaylists();
    expect(playlists.length).toBeGreaterThan(0);
    expect(playlists[0].tracks).toBeDefined();
    expect(playlists[0].tracks!.length).toBeGreaterThan(0);
  });

  it('getPlaylist returns detail + tracks', async () => {
    await ar.generatePlaylists();
    const playlists = await ar.listPlaylists();
    const detail = await ar.getPlaylist(playlists[0].id);
    expect(detail).not.toBeNull();
    expect(detail!.tracks!.length).toBeGreaterThan(0);
  });
});

describe('ar: recordPlay', () => {
  it('settles both legs', async () => {
    await ar.generatePlaylists();
    const playlists = await ar.listPlaylists();
    const playlist = playlists[0];
    const track = playlist.tracks![0];

    const r = await ar.recordPlay({
      playlistId: playlist.id,
      versionId: track.submission_id,
      listenerWallet: 'listener_001',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.play.status).toBe('settled');
      expect(r.play.listener_fee_usdc).toBe('0.001');
      expect(r.play.artist_payout_usdc).toBe('0.0005');
      expect(r.play.listener_tx_hash).toBeTruthy();
      expect(r.play.artist_tx_hash).toBeTruthy();
    }
  });

  it('rejects play on non-existent playlist', async () => {
    const r = await ar.recordPlay({
      playlistId: 'non-existent',
      versionId: submissionId,
      listenerWallet: 'test',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Playlist not found');
  });

  it('rejects play on non-existent version', async () => {
    await ar.generatePlaylists();
    const playlists = await ar.listPlaylists();
    const r = await ar.recordPlay({
      playlistId: playlists[0].id,
      versionId: 'non-existent',
      listenerWallet: 'test',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Version not found');
  });

  it('playlist stats accumulate plays', async () => {
    await ar.generatePlaylists();
    const playlists = await ar.listPlaylists();
    const playlist = playlists[0];
    const track = playlist.tracks![0];

    await ar.recordPlay({ playlistId: playlist.id, versionId: track.submission_id, listenerWallet: 'l1' });
    await ar.recordPlay({ playlistId: playlist.id, versionId: track.submission_id, listenerWallet: 'l2' });
    await ar.recordPlay({ playlistId: playlist.id, versionId: track.submission_id, listenerWallet: 'l3' });

    const stats = await ar.getPlaylistStats(playlist.id);
    expect(stats.total_plays).toBeGreaterThanOrEqual(3);
    expect(stats.total_revenue_usdc).toBeGreaterThan(0);
    expect(stats.total_paid_to_artists_usdc).toBeGreaterThan(0);
    expect(stats.ar_margin_usdc).toBeGreaterThan(0);
  });
});

describe('ar: constants', () => {
  it('exposes listener fee + artist payout', () => {
    expect(ar.listenerFee).toBe('0.001');
    expect(ar.artistPayout).toBe('0.0005');
  });
});
