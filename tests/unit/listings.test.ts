// MODULAR: Listing service tests — the unified supply primitive.
//
// The invariants worth locking here are the ones the pivot turns on: one
// blanket agreement accepted at creation (never per transaction), attribution
// generated rather than requested, disclosure mandatory on paid supply and
// forbidden on free supply, a music listing only creatable against a track the
// caller actually owns, and no curation gate — a listing is live on creation.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi: _vi } = await import('vitest');
_vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createListingsService } = await import('../../src/services/listings');
const { AGREEMENT_VERSION } = await import('../../src/lib/agreement');
const { submissions } = await import('../../src/lib/schema');

const OWNER = '0x' + 'a'.repeat(40);
const OTHER = '0x' + 'b'.repeat(40);

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

function makeService() {
  return createListingsService();
}

async function seedSubmission(id: string, artistWallet: string = OWNER) {
  await _getTestDb()
    .insert(submissions)
    .values({
      id,
      artistWallet,
      audioPath: `audio/${id}.mp3`,
      audioSizeBytes: 2048,
      contentType: 'audio/mpeg',
      feeQuoteUsdc: '0.50',
      title: 'Nightdrive',
      artistName: 'Seeder',
      versionType: 'studio',
      coverSvg: `<svg id="${id}"/>`,
      audioFeatures: { tempo: 84, key: 'Am', energy: 0.4, danceability: 0.5, acousticness: 0.6, loudness: -12, instrumentalness: 0.9, valence: 0.3 },
      status: 'published',
    })
    .onConflictDoNothing();
}

const freeMusic = {
  supplierWallet: OWNER,
  kind: 'music' as const,
  title: 'Nightdrive (lo-fi mix)',
  supplierName: 'Seeder',
  tags: ['lo-fi', 'focus', 'Instrumental'],
  submissionId: 'sub-1',
  tier: 'free' as const,
  agreementVersion: AGREEMENT_VERSION,
};

describe('agreement gate', () => {
  it('rejects a stale agreement version and writes nothing', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({ ...freeMusic, agreementVersion: 'marketplace-0.0.1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('AGREEMENT_VERSION_STALE');
    expect(await _getTestDb().select().from(submissions)).toHaveLength(1);
  });

  it('stamps the accepted agreement version on the row', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create(freeMusic);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.listing.agreement_version).toBe(AGREEMENT_VERSION);
  });
});

describe('tier, pricing and disclosure', () => {
  it('creates a free listing with no pricing and no disclosure', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create(freeMusic);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.tier).toBe('free');
    expect(res.listing.pricing).toBeNull();
    expect(res.listing.disclosure).toBeNull();
    // Free use carries no sponsored marker — adding one would mislabel it.
    expect(res.listing.attribution_text).not.toContain('#ad');
  });

  it('refuses a price on a free listing', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({
      ...freeMusic,
      pricing: { model: 'flat', flatFeeUsdc: '10' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_PRICING');
  });

  it('requires a price on a paid listing', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({ ...freeMusic, tier: 'paid' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_PRICING');
  });

  it('rejects a zero or malformed price', async () => {
    await seedSubmission('sub-1');
    const svc = makeService();
    for (const pricing of [
      { model: 'flat' as const, flatFeeUsdc: '0' },
      { model: 'flat' as const, flatFeeUsdc: '-5' },
      { model: 'flat' as const, flatFeeUsdc: 'ten' },
      { model: 'cpm' as const },
    ]) {
      const res = await svc.create({ ...freeMusic, tier: 'paid', pricing });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('INVALID_PRICING');
    }
  });

  it('bakes the disclosure marker into a paid listing\'s attribution', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({
      ...freeMusic,
      tier: 'paid',
      pricing: { model: 'flat', flatFeeUsdc: '25' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.disclosure).not.toBeNull();
    expect(res.listing.disclosure?.kind).toBe('sponsored');
    // The marker travels inside the credit string, so a channel cannot render
    // the attribution and drop the disclosure by choosing the shorter variant.
    expect(res.listing.attribution_text).toContain('#ad');
    expect(res.listing.attribution_text).toContain(res.listing.disclosure!.statement);
  });

  it('accepts a CPM price', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({
      ...freeMusic,
      tier: 'paid',
      pricing: { model: 'cpm', cpmUsdc: '4.50' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.listing.pricing).toEqual({ model: 'cpm', cpmUsdc: '4.5' });
  });
});

describe('budget cap', () => {
  it('is rejected on a free listing', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({ ...freeMusic, budgetCapUsdc: '100' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_BUDGET');
  });

  it('starts unspent and reports the remaining budget', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({
      ...freeMusic,
      tier: 'paid',
      pricing: { model: 'cpm', cpmUsdc: '4.50' },
      budgetCapUsdc: '250',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.budget_spent_usdc).toBe('0');
    expect(res.listing.budget_remaining_usdc).toBe('250');
  });

  it('null means uncapped', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({
      ...freeMusic,
      tier: 'paid',
      pricing: { model: 'flat', flatFeeUsdc: '25' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.budget_cap_usdc).toBeNull();
    expect(res.listing.budget_remaining_usdc).toBeNull();
  });
});

describe('music listings reuse the upload pipeline', () => {
  it('requires a submission reference', async () => {
    const res = await makeService().create({ ...freeMusic, submissionId: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SUBMISSION_REQUIRED');
  });

  it('rejects an unknown submission', async () => {
    const res = await makeService().create({ ...freeMusic, submissionId: 'nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SUBMISSION_NOT_FOUND');
  });

  it('refuses to list a track owned by another wallet', async () => {
    await seedSubmission('sub-1', OTHER);
    const res = await makeService().create(freeMusic);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SUBMISSION_NOT_OWNED');
  });

  it('copies audio, cover and features off the submission', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create(freeMusic);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.submission_id).toBe('sub-1');
    expect(res.listing.audio_path).toBe('audio/sub-1.mp3');
    expect(res.listing.cover_svg).toBe('<svg id="sub-1"/>');
    expect(res.listing.audio_features?.tempo).toBe(84);
    expect(res.listing.audio_features?.instrumentalness).toBe(0.9);
  });
});

describe('placement listings carry their own creative', () => {
  const placement = {
    supplierWallet: OWNER,
    kind: 'placement' as const,
    title: 'Coldbrew subscription',
    supplierName: 'Coldbrew Co',
    summary: 'Coffee delivered cold, weekly.',
    tags: ['coffee', 'subscription', 'morning-routine'],
    tier: 'paid' as const,
    pricing: { model: 'cpm' as const, cpmUsdc: '6' },
    agreementVersion: AGREEMENT_VERSION,
  };

  it('requires at least one image', async () => {
    const res = await makeService().create(placement);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('IMAGES_REQUIRED');
  });

  it('creates live supply with no submission link', async () => {
    const res = await makeService().create({ ...placement, images: ['ipfs://brew-1.png'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.kind).toBe('placement');
    expect(res.listing.submission_id).toBeNull();
    expect(res.listing.audio_path).toBeNull();
    expect(res.listing.images).toEqual(['ipfs://brew-1.png']);
    expect(res.listing.status).toBe('active');
    expect(res.listing.attribution_text).toContain('Featured: Coldbrew subscription by Coldbrew Co');
  });
});

describe('tags and attribution', () => {
  it('normalizes tags: trimmed, lowercased, deduped, capped', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({
      ...freeMusic,
      tags: ['  Lo-Fi ', 'lo-fi', 'focus', '', ...Array.from({ length: 20 }, (_, i) => `tag${i}`)],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.tags[0]).toBe('lo-fi');
    expect(res.listing.tags.filter((t) => t === 'lo-fi')).toHaveLength(1);
    expect(res.listing.tags.every((t) => t.length > 0)).toBe(true);
    expect(res.listing.tags.length).toBeLessThanOrEqual(12);
  });

  it('rejects a listing with no usable tags', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create({ ...freeMusic, tags: ['   ', ''] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_TAGS');
  });

  it('generates a stable slug and link back', async () => {
    await seedSubmission('sub-1');
    const res = await makeService().create(freeMusic);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.listing.attribution_url).toContain(`/listings/${res.listing.id}`);
    expect(res.listing.attribution_slug).toContain(res.listing.id.slice(0, 8));
    expect(res.listing.attribution_text).toContain(res.listing.attribution_url);
  });
});

describe('supplier control', () => {
  it('lists only live supply, filtered by catalog', async () => {
    await seedSubmission('sub-1');
    const svc = makeService();
    await svc.create(freeMusic);
    await svc.create({
      supplierWallet: OWNER,
      kind: 'placement',
      title: 'Coldbrew',
      supplierName: 'Coldbrew Co',
      tags: ['coffee'],
      images: ['ipfs://brew.png'],
      tier: 'paid',
      pricing: { model: 'flat', flatFeeUsdc: '10' },
      agreementVersion: AGREEMENT_VERSION,
    });
    expect(await svc.listActive()).toHaveLength(2);
    expect(await svc.listActive({ kind: 'music' })).toHaveLength(1);
    expect(await svc.listActive({ kind: 'placement' })).toHaveLength(1);
  });

  it('lets the supplier pause and resume', async () => {
    await seedSubmission('sub-1');
    const svc = makeService();
    const created = await svc.create(freeMusic);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const paused = await svc.setStatus(created.listing.id, OWNER, 'paused');
    expect(paused.ok).toBe(true);
    if (paused.ok) expect(paused.listing.status).toBe('paused');
    expect(await svc.listActive()).toHaveLength(0);

    const resumed = await svc.setStatus(created.listing.id, OWNER, 'active');
    expect(resumed.ok).toBe(true);
    expect(await svc.listActive()).toHaveLength(1);
  });

  it('refuses a status change from a wallet that does not own the listing', async () => {
    await seedSubmission('sub-1');
    const svc = makeService();
    const created = await svc.create(freeMusic);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const res = await svc.setStatus(created.listing.id, OTHER, 'paused');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LISTING_NOT_FOUND');
    // Still live — the stranger's attempt changed nothing.
    expect((await svc.get(created.listing.id))?.status).toBe('active');
  });

  it('reports a missing listing', async () => {
    const res = await makeService().setStatus('nope', OWNER, 'paused');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LISTING_NOT_FOUND');
    expect(await makeService().get('nope')).toBeNull();
  });
});
