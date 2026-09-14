// MODULAR: channel onboarding + verification tests.
//
// The point of this file is the fraud gate, not the happy path: a channel's
// distribution numbers must come from the platform, and a probe that invented
// them must never be able to produce a channel that can buy a paid slot.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi: _vi } = await import('vitest');
_vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createChannelsService } = await import('../../src/services/channels');
const { AGREEMENT_VERSION } = await import('../../src/lib/agreement');
const { ChannelUrlError } = await import('../../src/adapters/youtube');
const { channels: channelsTable } = await import('../../src/lib/schema');
const { eq } = await import('drizzle-orm');

const WALLET = '0x' + 'b'.repeat(40);
const URL = 'https://www.youtube.com/@demolo-fi';

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

/** A probe standing in for the platform API — real numbers, real verification. */
function platformProbe() {
  return {
    mock: false,
    platform: 'youtube' as const,
    probe: async () => fakeProbeResult(false),
  };
}

/** The offline deterministic probe — invented numbers, no verification. */
function mockProbe() {
  return {
    mock: true,
    platform: 'youtube' as const,
    probe: async () => fakeProbeResult(true),
  };
}

function fakeProbeResult(mock: boolean) {
  return {
    platform: 'youtube' as const,
    platformUrl: 'https://www.youtube.com/channel/UCdemo000000000000000000',
    platformChannelId: 'UCdemo000000000000000000',
    name: 'Lo-Fi Automation',
    description: 'Twenty-four hour lo-fi study streams, generated and scheduled.',
    subscriberCount: 120_000,
    viewCount: 9_000_000,
    videoCount: 340,
    recentContent: ['lofi beat to study to — 3 hour mix', 'night drive ambient set'],
    mock,
    probedAt: '2026-09-14T00:00:00.000Z',
  };
}

describe('channel registration', () => {
  it('rejects a stale agreement version without touching the DB', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: 'marketplace-0.0.1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('AGREEMENT_VERSION_STALE');
    const rows = await _getTestDb().select().from(channelsTable);
    expect(rows).toHaveLength(0);
  });

  it('accepts the current agreement version', async () => {
    expect(AGREEMENT_VERSION).toBeTruthy();
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
  });

  it('refuses a platform it cannot verify rather than trusting self-reported reach', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: 'https://example.com/feed',
      platform: 'other',
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('PLATFORM_UNSUPPORTED');
  });

  it('maps an unparseable URL to INVALID_PLATFORM_URL', async () => {
    const svc = createChannelsService({
      mock: false,
      platform: 'youtube',
      probe: async () => {
        throw new ChannelUrlError('Could not find a channel in that URL');
      },
    });
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: 'https://vimeo.com/12345',
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_PLATFORM_URL');
  });

  it('maps a probe failure to PROBE_FAILED', async () => {
    const svc = createChannelsService({
      mock: false,
      platform: 'youtube',
      probe: async () => {
        throw new Error('youtube.channels failed (503): upstream');
      },
    });
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('PROBE_FAILED');
  });

  it('creates one row per distribution surface, not one per click', async () => {
    const svc = createChannelsService(platformProbe());
    const first = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    const second = await svc.register({
      ownerWallet: '0x' + 'c'.repeat(40),
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok) expect(first.alreadyRegistered).toBe(false);
    if (second.ok) expect(second.alreadyRegistered).toBe(true);
    if (first.ok && second.ok) expect(second.channel.id).toBe(first.channel.id);
    const rows = await _getTestDb().select().from(channelsTable);
    expect(rows).toHaveLength(1);
  });
});

describe('verification gate', () => {
  it('verifies a channel against platform numbers and unlocks paid slots', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.channel.verification_status).toBe('verified');
    expect(res.channel.stats.source).toBe('platform_api');
    expect(res.channel.stats.subscriber_count).toBe(120_000);
    expect(res.channel.stats.verified_at).toBe('2026-09-14T00:00:00.000Z');
    expect(res.channel.can_buy_slots).toBe(true);
  });

  it('holds a mock probe at pending so invented numbers cannot unlock a paid slot', async () => {
    const svc = createChannelsService(mockProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.channel.verification_status).toBe('pending');
    expect(res.channel.stats.source).toBe('mock');
    expect(res.channel.can_buy_slots).toBe(false);
    // Recording a verification time for invented numbers would make them
    // indistinguishable from real ones downstream.
    expect(res.channel.stats.verified_at).toBeNull();
    expect(res.channel.verification_error).toBeTruthy();
  });

  it('never writes a self_reported stats source', async () => {
    const svc = createChannelsService(mockProbe());
    await svc.register({ ownerWallet: WALLET, platformUrl: URL, agreementVersion: AGREEMENT_VERSION });
    const [row] = await _getTestDb().select().from(channelsTable);
    expect(['platform_api', 'mock']).toContain(row.statsSource);
    expect(row.statsSource).not.toBe('self_reported');
  });

  it('does not downgrade a verified channel when a re-probe fails', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const flaky = createChannelsService({
      mock: false,
      platform: 'youtube',
      probe: async () => {
        throw new Error('quota exceeded');
      },
    });
    const reverify = await flaky.verify(res.channel.id);
    expect(reverify.ok).toBe(false);

    const after = await svc.get(res.channel.id);
    expect(after?.verification_status).toBe('verified');
    expect(after?.stats.source).toBe('platform_api');
    expect(after?.can_buy_slots).toBe(true);
    expect(after?.verification_error).toBeTruthy();
  });

  it('promotes a pending channel when verification becomes real', async () => {
    const pending = createChannelsService(mockProbe());
    const res = await pending.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.channel.can_buy_slots).toBe(false);

    const keyed = createChannelsService(platformProbe());
    const verified = await keyed.verify(res.channel.id);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.channel.verification_status).toBe('verified');
    expect(verified.channel.can_buy_slots).toBe(true);
    expect(verified.channel.verification_error).toBeNull();
  });

  it('reports CHANNEL_NOT_FOUND for an unknown id', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.verify('missing');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('a suspended verified channel still cannot buy slots', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await _getTestDb()
      .update(channelsTable)
      .set({ status: 'suspended' })
      .where(eq(channelsTable.id, res.channel.id));
    const after = await svc.get(res.channel.id);
    expect(after?.verification_status).toBe('verified');
    expect(after?.can_buy_slots).toBe(false);
  });
});

describe('ethos profile', () => {
  it('separates platform-pulled text from operator-typed text', async () => {
    const svc = createChannelsService(platformProbe());
    const res = await svc.register({
      ownerWallet: WALLET,
      platformUrl: URL,
      niche: 'lo-fi study',
      ethosSummary: 'Calm background audio for long focus sessions.',
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.channel.niche).toBe('lo-fi study');
    expect(res.channel.recent_content).toHaveLength(2);

    const text = await svc.ethosText(res.channel.id);
    expect(text).toContain('niche: lo-fi study');
    expect(text).toContain('Calm background audio');
    // The platform's own channel description, pulled at verification.
    expect(text).toContain('Twenty-four hour lo-fi study streams');
    // Recent uploads are the strongest ethos signal — what it actually ships.
    expect(text).toContain('recent: lofi beat to study to — 3 hour mix');
  });

  it('returns null for an unknown channel', async () => {
    const svc = createChannelsService(platformProbe());
    expect(await svc.ethosText('missing')).toBeNull();
  });
});

describe('listing for a wallet', () => {
  it('returns only that wallet\'s channels', async () => {
    let seq = 0;
    const svc = createChannelsService({
      mock: false,
      platform: 'youtube',
      probe: async (url: string) => {
        seq += 1;
        return {
          ...fakeProbeResult(false),
          platformUrl: url,
          platformChannelId: `UC${String(seq).padStart(22, '0')}`,
        };
      },
    });
    await svc.register({ ownerWallet: WALLET, platformUrl: 'https://youtube.com/@one', agreementVersion: AGREEMENT_VERSION });
    await svc.register({ ownerWallet: WALLET, platformUrl: 'https://youtube.com/@two', agreementVersion: AGREEMENT_VERSION });
    await svc.register({
      ownerWallet: '0x' + 'd'.repeat(40),
      platformUrl: 'https://youtube.com/@three',
      agreementVersion: AGREEMENT_VERSION,
    });
    const mine = await svc.listForWallet(WALLET);
    expect(mine).toHaveLength(2);
    expect(mine.every((c) => c.owner_wallet === WALLET.toLowerCase())).toBe(true);
  });
});
