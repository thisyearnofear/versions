import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  KIT_LIMIT,
  KIT_STORAGE_KEY,
  addKitItem,
  clearKit,
  getKitSnapshot,
  isKitPersisted,
  kitCreditsText,
  kitExportText,
  kitFreeItems,
  kitItemFromListing,
  kitListingHref,
  kitPaidItems,
  parseKitItems,
  reloadKit,
  removeKitItem,
  safeKitHref,
  sanitizeKitItem,
  subscribeToKit,
  type KitItem,
} from '../../src/lib/kit';
import type { MarketplaceListing } from '../../src/lib/marketplace-client';

// ── node-env localStorage stub (vitest environment is 'node') ──
let store: Map<string, string>;

function installWindow(withStorage = true) {
  store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { window: unknown }).window = withStorage
    ? { localStorage, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    : { addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

function freeItem(overrides: Partial<KitItem> = {}): KitItem {
  return {
    listingId: 'l-free',
    kind: 'music',
    tier: 'free',
    title: 'Midnight Study',
    supplierName: 'Luna Rivera',
    priceLabel: 'Free · credit required',
    attributionText: 'Music: Midnight Study by Luna Rivera — via VERSIONS https://x/listings/l-free',
    attributionUrl: 'https://x/listings/l-free',
    disclosure: null,
    media: [{ label: 'Audio file', href: 'https://api.grove.storage/abc' }],
    addedAt: '2026-09-24T00:00:00.000Z',
    channelId: null,
    ...overrides,
  };
}

function paidItem(overrides: Partial<KitItem> = {}): KitItem {
  return {
    listingId: 'l-paid',
    kind: 'placement',
    tier: 'paid',
    title: 'Walnut Stand',
    supplierName: 'Analog & Oak',
    priceLabel: '25.00 USDC flat',
    attributionText: '',
    attributionUrl: 'https://x/listings/l-paid',
    disclosure: { label: '#ad', statement: 'Sponsored placement arranged through VERSIONS.' },
    media: [],
    addedAt: '2026-09-24T00:00:00.000Z',
    channelId: null,
    ...overrides,
  };
}

beforeEach(() => {
  installWindow();
  clearKit();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('safeKitHref', () => {
  it('accepts https and site-relative, drops everything else', () => {
    expect(safeKitHref('https://versions.persidian.com/listings/a')).toBe(
      'https://versions.persidian.com/listings/a',
    );
    expect(safeKitHref('/listings/a')).toBe('/listings/a');
    expect(safeKitHref('javascript:alert(1)')).toBeNull();
    expect(safeKitHref('http://insecure.example.com/a')).toBeNull();
    expect(safeKitHref('//evil.example.com/a')).toBeNull();
    expect(safeKitHref('data:text/html,hi')).toBeNull();
    expect(safeKitHref('')).toBeNull();
    expect(safeKitHref(42)).toBeNull();
    expect(safeKitHref(`https://x/${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('sanitizeKitItem', () => {
  it('drops entries without an id or title', () => {
    expect(sanitizeKitItem(null)).toBeNull();
    expect(sanitizeKitItem('nope')).toBeNull();
    expect(sanitizeKitItem({ title: 'no id' })).toBeNull();
    expect(sanitizeKitItem({ listingId: 'x' })).toBeNull();
  });

  it('never carries a paid credit, even if storage was hand-edited', () => {
    const paid = sanitizeKitItem({
      listingId: 'p1',
      title: 'Walnut Stand',
      tier: 'paid',
      attributionText: 'Featured: Walnut Stand #ad — sponsored placement',
      disclosure: { label: '#ad', statement: 'Sponsored placement arranged through VERSIONS.' },
    });
    expect(paid?.attributionText).toBe('');
    expect(paid?.tier).toBe('paid');
    expect(paid?.disclosure?.label).toBe('#ad');
  });

  it('keeps a free listing\'s credit and coerces unknown enums safely', () => {
    const free = sanitizeKitItem({
      listingId: 'f1',
      title: 'Midnight Study',
      tier: 'free',
      kind: 'weird',
      attributionText: 'Music: Midnight Study — via VERSIONS',
    });
    expect(free?.attributionText).toBe('Music: Midnight Study — via VERSIONS');
    expect(free?.kind).toBe('music');
    expect(free?.disclosure).toBeNull();
  });

  it('drops unsafe media hrefs but keeps the safe ones', () => {
    const item = sanitizeKitItem({
      listingId: 'f2',
      title: 'Track',
      tier: 'free',
      media: [
        { label: 'Audio file', href: 'https://api.grove.storage/ok' },
        { label: 'Evil', href: 'javascript:alert(1)' },
        { label: 'Insecure', href: 'http://x/a' },
        'not-an-object',
      ],
    });
    expect(item?.media).toEqual([{ label: 'Audio file', href: 'https://api.grove.storage/ok' }]);
  });
});

describe('parseKitItems', () => {
  it('treats a non-array as an empty kit', () => {
    expect(parseKitItems(null)).toEqual([]);
    expect(parseKitItems({})).toEqual([]);
    expect(parseKitItems('[]')).toEqual([]);
  });

  it('de-dupes by listing id and caps the kit', () => {
    const dupe = parseKitItems([
      { listingId: 'a', title: 'A', tier: 'free' },
      { listingId: 'a', title: 'A again', tier: 'free' },
      { listingId: 'b', title: 'B', tier: 'free' },
    ]);
    expect(dupe.map((i) => i.listingId)).toEqual(['a', 'b']);

    const many = parseKitItems(
      Array.from({ length: KIT_LIMIT + 10 }, (_, i) => ({
        listingId: `l${i}`,
        title: `L${i}`,
        tier: 'free',
      })),
    );
    expect(many).toHaveLength(KIT_LIMIT);
  });
});

describe('kitItemFromListing', () => {
  const listing = {
    id: 'l1',
    kind: 'music',
    tier: 'free',
    title: 'Midnight Study',
    supplier_name: 'Luna Rivera',
    attribution_text: 'Music: Midnight Study by Luna Rivera — via VERSIONS',
    attribution_url: 'https://versions.persidian.com/listings/l1',
    audio_path: 'data/uploads/midnight.mp3',
    images: [],
    pricing: null,
    disclosure: null,
  } as unknown as MarketplaceListing;

  it('snapshots a free listing with its credit and media', () => {
    const item = kitItemFromListing(listing, 'chan-1', new Date('2026-09-24T12:00:00Z'));
    expect(item.attributionText).toBe('Music: Midnight Study by Luna Rivera — via VERSIONS');
    expect(item.priceLabel).toBe('Free · credit required');
    expect(item.media).toEqual([
      { label: 'Audio file', href: '/api/v1/uploads/midnight.mp3' },
    ]);
    expect(item.channelId).toBe('chan-1');
    expect(item.addedAt).toBe('2026-09-24T12:00:00.000Z');
  });

  it('snapshots a paid listing with no credit and no media', () => {
    const paid = {
      ...listing,
      id: 'l2',
      kind: 'placement',
      tier: 'paid',
      pricing: { model: 'flat', flatFeeUsdc: '25.00' },
      disclosure: { kind: 'sponsored', label: '#ad', statement: 'Sponsored.' },
      images: ['https://cdn.example.com/hero.png'],
    } as unknown as MarketplaceListing;
    const item = kitItemFromListing(paid);
    expect(item.tier).toBe('paid');
    expect(item.attributionText).toBe('');
    expect(item.media).toEqual([]);
    expect(item.priceLabel).toBe('25.00 USDC flat');
    expect(item.disclosure?.label).toBe('#ad');
  });
});

describe('kit store', () => {
  it('adds newest-first, refreshes duplicates instead of duplicating', () => {
    addKitItem(freeItem());
    addKitItem(paidItem());
    expect(getKitSnapshot().map((i) => i.listingId)).toEqual(['l-paid', 'l-free']);

    addKitItem(freeItem({ title: 'Midnight Study (updated)' }));
    const snap = getKitSnapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].listingId).toBe('l-free');
    expect(snap[0].title).toBe('Midnight Study (updated)');
  });

  it('persists a round-trip through storage', () => {
    addKitItem(freeItem());
    const raw = store.get(KIT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(parseKitItems(JSON.parse(raw!))).toHaveLength(1);
  });

  it('removes and clears', () => {
    addKitItem(freeItem());
    addKitItem(paidItem());
    removeKitItem('l-free');
    expect(getKitSnapshot().map((i) => i.listingId)).toEqual(['l-paid']);
    clearKit();
    expect(getKitSnapshot()).toEqual([]);
  });

  it('keeps one stable snapshot reference until the kit changes (useSyncExternalStore)', () => {
    const first = getKitSnapshot();
    expect(getKitSnapshot()).toBe(first);
    addKitItem(freeItem());
    expect(getKitSnapshot()).not.toBe(first);
    const second = getKitSnapshot();
    expect(getKitSnapshot()).toBe(second);
  });

  it('recovers from corrupt or junk storage without throwing', () => {
    store.set(KIT_STORAGE_KEY, '{not json');
    expect(reloadKit()).toEqual([]);
    store.set(KIT_STORAGE_KEY, JSON.stringify([{ nope: true }, { listingId: 'ok', title: 'Ok', tier: 'free' }]));
    expect(reloadKit().map((i) => i.listingId)).toEqual(['ok']);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToKit(listener);
    addKitItem(freeItem());
    expect(listener).toHaveBeenCalledTimes(1);
    removeKitItem('l-free');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    addKitItem(paidItem());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('still holds the kit in memory when storage is unavailable, and says so', () => {
    installWindow(false);
    clearKit();
    addKitItem(freeItem());
    expect(getKitSnapshot()).toHaveLength(1);
    expect(isKitPersisted()).toBe(false);
  });
});

describe('kit text — free ships, paid never does', () => {
  const free = freeItem();
  const paid = paidItem();
  const items = [free, paid];

  it('splits free from paid', () => {
    expect(kitFreeItems(items)).toEqual([free]);
    expect(kitPaidItems(items)).toEqual([paid]);
  });

  it('copies credit lines for free supply only', () => {
    const text = kitCreditsText(items);
    expect(text).toBe(free.attributionText);
    expect(text).not.toContain('Walnut Stand');
  });

  it('exports free supply ready to publish, and paid as a shortlist to reserve', () => {
    const text = kitExportText(items, {
      exportedAt: new Date('2026-09-24T12:00:00Z'),
      siteOrigin: 'https://versions.persidian.com',
    });
    expect(text).toContain('VERSIONS kit — 2 listings (1 free, 1 paid)');
    expect(text).toContain('Exported 2026-09-24T12:00:00.000Z');
    expect(text).toContain('FREE · ready to publish');
    expect(text).toContain(free.attributionText);
    expect(text).toContain('Audio file: https://api.grove.storage/abc');
    expect(text).toContain('PAID · not purchased yet');
    expect(text).toContain('Not purchased — reserve this placement before publishing.');
    expect(text).toContain('Reserve: https://versions.persidian.com/listings/l-paid');
  });

  it('never claims a use was logged or a delivery verified', () => {
    const text = kitExportText(items);
    expect(text).toContain('Copying a credit does not log a use');
    expect(text).not.toMatch(/\blogged\b(?! a use)/);
    expect(text).not.toContain('verified');
    expect(text).not.toContain('delivered');
  });

  it('links back with the channel context it was captured under', () => {
    expect(kitListingHref(freeItem({ channelId: 'chan 1' }))).toBe(
      '/listings/l-free?channelId=chan%201',
    );
    expect(kitListingHref(freeItem())).toBe('/listings/l-free');
  });
});
