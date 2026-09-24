import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  browseHref,
  searchHref,
  uploadAudioHref,
  mediaHref,
  settlementLabel,
  updateBrowseHref,
  listingPriceLabel,
  createRequestScope,
  parseUsageCount,
  publishedUrl,
  marketplaceRequest,
  MarketplaceError,
} from '../../src/lib/marketplace-client';

function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('marketplaceRequest', () => {
  it('unwraps a successful envelope', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ success: true, data: { hello: 'world' } }), { status: 200 }),
    );
    const data = await marketplaceRequest<{ hello: string }>('/api/v1/x');
    expect(data.hello).toBe('world');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/x');
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe('same-origin');
  });

  it('prefixes NEXT_PUBLIC_API_URL and uses include credentials', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    stubFetch(async () =>
      new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }),
    );
    await marketplaceRequest<{ ok: boolean }>('/api/v1/x');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.example.com/api/v1/x');
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe('include');
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  it('rejects failed HTTP with the server message and code', async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({ success: false, error: { code: 'CHANNEL_UNVERIFIED', message: 'Verify first.' } }),
        { status: 403 },
      ),
    );
    const err = await marketplaceRequest('/api/v1/x').catch((e) => e);
    expect(err).toBeInstanceOf(MarketplaceError);
    expect(err.message).toBe('Verify first.');
    expect(err.status).toBe(403);
    expect(err.code).toBe('CHANNEL_UNVERIFIED');
  });

  it('rejects a success:false 200 envelope', async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({ success: false, error: { code: 'X', message: 'Nope.' } }),
        { status: 200 },
      ),
    );
    await expect(marketplaceRequest('/api/v1/x')).rejects.toBeInstanceOf(MarketplaceError);
  });

  it('rejects malformed JSON', async () => {
    stubFetch(async () => new Response('not-json', { status: 200 }));
    await expect(marketplaceRequest('/api/v1/x')).rejects.toBeInstanceOf(MarketplaceError);
  });

  it('rejects a 200 envelope with null data', async () => {
    stubFetch(async () => new Response(JSON.stringify({ success: true, data: null }), { status: 200 }));
    await expect(marketplaceRequest('/api/v1/x')).rejects.toBeInstanceOf(MarketplaceError);
  });
});

describe('browseHref', () => {
  it('carries query/channel context and valid kind/tier only', () => {
    expect(browseHref({ q: ' lo-fi night ', channelId: 'c1', kind: 'music', tier: 'paid' })).toBe(
      '/discover?q=lo-fi+night&channelId=c1&kind=music&tier=paid',
    );
    expect(browseHref({ kind: 'bogus', tier: 'bogus' })).toBe('/discover');
    expect(browseHref({ q: '  ' })).toBe('/discover');
  });
});

describe('searchHref', () => {
  it('includes kind/tier even on an empty search and encodes channel/query', () => {
    const href = searchHref({ q: 'a & b', channelId: 'ch 1', kind: 'placement', tier: 'free' }, 40);
    expect(href.startsWith('/api/v1/marketplace/search?')).toBe(true);
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('q')).toBe('a & b');
    expect(p.get('channelId')).toBe('ch 1');
    expect(p.get('kind')).toBe('placement');
    expect(p.get('tier')).toBe('free');
    expect(p.get('limit')).toBe('20');
    expect(p.get('offset')).toBe('40');
  });
});

describe('uploadAudioHref', () => {
  it('encodes only the file name', () => {
    expect(uploadAudioHref('data/uploads/my file.mp3')).toBe('/api/v1/uploads/my%20file.mp3');
  });
});

describe('mediaHref', () => {
  it('maps ipfs and https, rejects everything else', () => {
    expect(mediaHref('lens://abc123def')).toBe('https://api.grove.storage/abc123def');
    expect(mediaHref('ipfs://bafy123')).toBe('https://gateway.pinata.cloud/ipfs/bafy123');
    expect(mediaHref('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(mediaHref('http://insecure.example.com/a.png')).toBeNull();
    expect(mediaHref('javascript:alert(1)')).toBeNull();
    expect(mediaHref('data:image/png;base64,xxx')).toBeNull();
    expect(mediaHref('not a url')).toBeNull();
  });
});

describe('settlementLabel', () => {
  it('mock overrides settled claims', () => {
    expect(settlementLabel({ payment_mock: true }, { status: 'settled', tx_hash: '0xabc' })).toBe('Demo settlement');
  });
  it('real leg needs status settled AND tx hash', () => {
    expect(settlementLabel({ payment_mock: false }, { status: 'settled', tx_hash: '0xabc' })).toBe('Settled on Arc');
    expect(settlementLabel({ payment_mock: false }, { status: 'settled', tx_hash: null })).toBe('Settlement pending');
    expect(settlementLabel({ payment_mock: false }, { status: 'pending', tx_hash: '0xabc' })).toBe('Settlement pending');
  });
});

describe('updateBrowseHref', () => {
  it('preserves unrelated legacy params while patching q/kind', () => {
    const href = updateBrowseHref('brief=hello&showcase=1&q=old', { q: 'new vibe', kind: 'music' });
    const [path, qs] = href.split('?');
    expect(path).toBe('/discover');
    const p = new URLSearchParams(qs);
    expect(p.get('brief')).toBe('hello');
    expect(p.get('showcase')).toBe('1');
    expect(p.get('q')).toBe('new vibe');
    expect(p.get('kind')).toBe('music');
  });

  it('clears offset in the same patch as a filter change', () => {
    const href = updateBrowseHref('q=lo-fi&offset=40', { tier: 'free', offset: null });
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('tier')).toBe('free');
    expect(p.get('offset')).toBeNull();
    expect(p.get('q')).toBe('lo-fi');
  });

  it('drops kind/tier set to all and empty values, returns bare path when empty', () => {
    expect(updateBrowseHref('kind=music&tier=paid', { kind: 'all', tier: 'all' })).toBe('/discover');
    expect(updateBrowseHref('q=x', { q: '' })).toBe('/discover');
    expect(updateBrowseHref('q=x', { q: null })).toBe('/discover');
  });
});

describe('createRequestScope', () => {
  it('a newer start() aborts the older request and stale-checks it out', () => {
    const scope = createRequestScope();
    const first = scope.start();
    const second = scope.start();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('cancel() aborts the current request and invalidates its token', () => {
    const scope = createRequestScope();
    const req = scope.start();
    scope.cancel();
    expect(req.signal.aborted).toBe(true);
    expect(req.isCurrent()).toBe(false);
  });

  it('sequences real requests: only the latest commits', async () => {
    const scope = createRequestScope();
    const commits: string[] = [];
    const run = (label: string, delay: number) => {
      const { isCurrent } = scope.start();
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          if (isCurrent()) commits.push(label);
          resolve();
        }, delay),
      );
    };
    const slow = run('stale', 20);
    const fast = run('fresh', 0);
    await Promise.all([slow, fast]);
    expect(commits).toEqual(['fresh']);
  });
});

describe('parseUsageCount', () => {
  it('accepts blank as 0 and plain decimal integers', () => {
    expect(parseUsageCount('')).toBe(0);
    expect(parseUsageCount('   ')).toBe(0);
    expect(parseUsageCount('0')).toBe(0);
    expect(parseUsageCount(' 42 ')).toBe(42);
    expect(parseUsageCount('100000000')).toBe(100000000);
  });
  it('rejects negatives, fractions, NaN, hex, scientific, and over-max', () => {
    expect(parseUsageCount('-3')).toBeNull();
    expect(parseUsageCount('1.5')).toBeNull();
    expect(parseUsageCount('NaN')).toBeNull();
    expect(parseUsageCount('0x10')).toBeNull();
    expect(parseUsageCount('1e6')).toBeNull();
    expect(parseUsageCount('abc')).toBeNull();
    expect(parseUsageCount('100000001')).toBeNull();
    expect(parseUsageCount('99999999999999999999')).toBeNull();
  });
});

describe('publishedUrl', () => {
  it('returns the exact trimmed string for https URLs', () => {
    expect(publishedUrl('  https://youtu.be/abc?x=1 ')).toBe('https://youtu.be/abc?x=1');
  });
  it('rejects malformed, http, and other protocols', () => {
    expect(publishedUrl('not a url')).toBeNull();
    expect(publishedUrl('')).toBeNull();
    expect(publishedUrl('http://example.com/v')).toBeNull();
    expect(publishedUrl('javascript:alert(1)')).toBeNull();
    expect(publishedUrl('ftp://example.com/v')).toBeNull();
  });
});

describe('listingPriceLabel', () => {
  it('covers free, flat, cpm, and missing-pricing paid listings', () => {
    expect(listingPriceLabel({ tier: 'free', pricing: null } as never)).toBe('Free with required credit');
    expect(
      listingPriceLabel({ tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '25.00' } } as never),
    ).toBe('25.00 USDC · flat fee');
    expect(
      listingPriceLabel({ tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '4.50' } } as never),
    ).toBe('4.50 USDC per 1,000 impressions');
    expect(listingPriceLabel({ tier: 'paid', pricing: null } as never)).toBe(
      'Paid placement · pricing unavailable',
    );
  });
});

describe('independent request scopes', () => {
  it('cancelling one scope does not affect another', () => {
    const a = createRequestScope();
    const b = createRequestScope();
    const ra = a.start();
    const rb = b.start();
    a.cancel();
    expect(ra.isCurrent()).toBe(false);
    expect(rb.isCurrent()).toBe(true);
    expect(rb.signal.aborted).toBe(false);
  });
});
