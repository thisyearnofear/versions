import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const rest = { ...props };
    for (const k of ['fill', 'unoptimized', 'priority']) delete rest[k];
    return React.createElement('img', rest);
  },
}));

// The browse chrome is client code; static render only needs the router stub.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { PublishingKit } from '@/components/marketplace/PublishingKit';
import { ListingMedia } from '@/components/marketplace/ListingMedia';
import { PriceBadge } from '@/components/marketplace/PriceBadge';
import { FitNote } from '@/components/marketplace/FitNote';
import { InventoryHeader } from '@/components/discovery/InventoryHeader';
import { ChannelProbe, handleFromChannelInput } from '@/components/discovery/ChannelProbe';
import { KitBarView } from '@/components/marketplace/KitBar';
import { AddToKitButton } from '@/components/marketplace/AddToKitButton';
import type { KitItem } from '@/lib/kit';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

/** Collapse SSR markup (incl. React's text-node comments) into readable text. */
const textOf = (html: string) =>
  html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const kitFree: KitItem = {
  listingId: 'l-free',
  kind: 'music',
  tier: 'free',
  title: 'Midnight Study',
  supplierName: 'Luna Rivera',
  priceLabel: 'Free · credit required',
  attributionText: 'Music: Midnight Study by Luna Rivera — via VERSIONS',
  attributionUrl: 'https://x/listings/l-free',
  disclosure: null,
  media: [{ label: 'Audio file', href: 'https://api.grove.storage/abc' }],
  addedAt: '2026-09-24T00:00:00.000Z',
  channelId: null,
};

const kitPaid: KitItem = {
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
};

describe('PublishingKit presentation', () => {
  it('escapes hostile attribution text verbatim — no markup injection', () => {
    const hostile = 'Credit <script>alert(1)</script> <img src=x onerror=alert(2)>';
    const html = render(React.createElement(PublishingKit, { attributionText: hostile }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a real paid credit and disclosure — not placeholder text', () => {
    const credit = 'Featured: Cold Brew Kit by North Roast — via VERSIONS https://versions.persidian.com/listings/l1 #ad — Sponsored placement arranged through VERSIONS.';
    const html = render(
      React.createElement(PublishingKit, {
        attributionText: credit,
        trackingUrl: 'https://versions.persidian.com/t/abc123',
        disclosure: { label: '#ad', statement: 'Sponsored placement arranged through VERSIONS.' },
      }),
    );
    expect(html).toContain('Cold Brew Kit');
    expect(html).toContain('#ad');
    expect(html).toContain('Sponsored placement arranged through VERSIONS.');
    expect(html).not.toContain('preview');
    expect(html).toContain('Tracking link');
    expect(html).toContain('https://versions.persidian.com/t/abc123');
  });

  it('labels the free link "Attribution link" and never "Tracking link"', () => {
    const html = render(
      React.createElement(PublishingKit, {
        attributionText: 'Music: Night Drive by Luma — via VERSIONS https://versions.persidian.com/listings/l2',
        trackingUrl: 'https://versions.persidian.com/listings/l2',
        linkLabel: 'Attribution link',
      }),
    );
    expect(html).toContain('Attribution link');
    expect(html).not.toContain('Tracking link');
  });

  it('reportHint=false hides the "below" suffix', () => {
    const withHint = render(React.createElement(PublishingKit, { attributionText: 'x' }));
    expect(withHint).toContain('report where it ran below');
    const without = render(
      React.createElement(PublishingKit, { attributionText: 'x', reportHint: false }),
    );
    expect(without).not.toContain('report where it ran below');
    expect(without).toContain('Copying the credit does not log a use');
  });

  it('never renders a javascript: tracking URL', () => {
    const html = render(
      React.createElement(PublishingKit, {
        attributionText: 'x',
        trackingUrl: 'javascript:alert(1)',
      }),
    );
    expect(html).not.toContain('javascript:');
  });
});

describe('PriceBadge presentation', () => {
  it('shows the compact price on the card for both tiers', () => {
    const free = render(
      React.createElement(PriceBadge, { listing: { tier: 'free', pricing: null } as never }),
    );
    expect(free).toContain('Free · credit required');
    const paid = render(
      React.createElement(PriceBadge, {
        listing: { tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '3.00' } } as never,
      }),
    );
    expect(paid).toContain('3.00 USDC flat');
  });
});

describe('FitNote presentation', () => {
  it('leads with prose and keeps the raw score out of the visible text', () => {
    const html = render(
      React.createElement(FitNote, { whyFits: ['tag: lo-fi', 'tag: study'], fitScore: 0.95 }),
    );
    expect(html).toContain('Fits: lo-fi · study');
    expect(html).not.toContain('tag:');
    // The score exists only as an affordance on hover, never as the headline.
    expect(html).toMatch(/title="Match score 0\.95/);
    expect(html).not.toMatch(/>\s*0\.95\s*</);
  });

  it('falls back to tags, and renders nothing when there is neither', () => {
    expect(render(React.createElement(FitNote, { tags: ['lo-fi', 'focus'] }))).toContain(
      'lo-fi · focus',
    );
    expect(render(React.createElement(FitNote, {}))).toBe('');
  });
});

describe('InventoryHeader presentation', () => {
  it('states the slice totals when counts are present', () => {
    const html = render(
      React.createElement(InventoryHeader, {
        total: 8,
        counts: { total: 32, music: 18, placement: 14, free: 21, paid: 11 },
        mode: 'semantic',
        sort: 'fit',
        query: 'lo-fi study',
        selectedChannelName: 'Lofi Study Radio',
        kind: 'all',
        tier: 'free',
        loading: false,
      }),
    );
    expect(html).toContain('8 listings');
    expect(html).toContain('32 in this slice');
    expect(html).toContain('18 music');
    expect(html).toContain('11 paid');
    expect(html).toContain('free only');
    expect(html).toContain('Lofi Study Radio ethos');
  });

  it('claims no inventory when counts are absent', () => {
    const html = render(
      React.createElement(InventoryHeader, {
        total: 0,
        counts: undefined,
        mode: 'recent',
        sort: 'newest',
        query: '',
        selectedChannelName: null,
        kind: 'all',
        tier: 'all',
        loading: false,
      }),
    );
    expect(html).toContain('0 listings');
    expect(html).not.toContain('in this slice');
    expect(html).toContain('newest first');
  });
});

describe('ChannelProbe — guest relevance without identity', () => {
  it('derives a usable vibe from a channel URL/handle and passes phrases through', () => {
    expect(handleFromChannelInput('https://www.youtube.com/@lofi.girl')).toBe('lofi girl');
    expect(handleFromChannelInput('https://www.youtube.com/c/Late-Night-Drive')).toBe(
      'Late Night Drive',
    );
    expect(handleFromChannelInput('lo-fi study streams')).toBe('lo-fi study streams');
    expect(handleFromChannelInput('UC' + 'a'.repeat(22))).toBe('');
    expect(handleFromChannelInput('   ')).toBe('');
  });

  it('renders the honest preview copy — no saved state, no verified-ethos claim', () => {
    const html = render(React.createElement(ChannelProbe));
    expect(html).toContain('No account, nothing saved');
    expect(html).toContain('Ranked from what you told us');
    expect(html).toContain('See what fits');
    // Ethos ranking needs a registered + verified channel; the probe must not
    // borrow that word for a query preview.
    expect(html).not.toContain('ethos ranking');
    expect(html).toContain('/channels');
  });
});

describe('KitBar presentation', () => {
  it('renders nothing when the kit is empty', () => {
    expect(render(React.createElement(KitBarView, { items: [] }))).toBe('');
  });

  it('counts saved, ready-to-publish, and to-reserve separately', () => {
    const html = render(React.createElement(KitBarView, { items: [kitFree, kitPaid] }));
    const text = textOf(html);
    expect(text).toContain('2 saved');
    expect(text).toContain('1 ready to publish');
    expect(text).toContain('1 to reserve');
    expect(text).toContain('Copy credits');
    expect(text).toContain('Export .txt');
  });

  it('never claims a use was logged, and says where the kit actually lives', () => {
    const text = textOf(render(React.createElement(KitBarView, { items: [kitFree] })));
    expect(text).toContain('Copying a credit does not log a use');
    expect(text).toContain('Saved in this browser.');
    expect(text).not.toContain('sync');
    expect(text).not.toContain('verified');
    const memoryOnly = textOf(
      render(React.createElement(KitBarView, { items: [kitFree], persisted: false })),
    );
    expect(memoryOnly).toContain('Saved for this visit only');
  });

  it('keeps the shortlist collapsed until asked, and never renders a paid credit', () => {
    const smuggled = { ...kitPaid, attributionText: 'Featured: Walnut Stand #ad — sponsored' };
    const html = render(React.createElement(KitBarView, { items: [kitFree, smuggled] }));
    // Collapsed by default.
    expect(html).not.toContain('Midnight Study');
    expect(html).not.toContain('Walnut Stand');
    // Defense in depth: the bar has no path that renders a credit at all.
    expect(html).not.toContain('#ad');
    expect(html).not.toContain('sponsored');
  });
});

describe('AddToKitButton presentation', () => {
  it('renders the add affordance with no account required', () => {
    const html = render(
      React.createElement(AddToKitButton, {
        listing: { id: 'l-free', tier: 'free' } as never,
      }),
    );
    expect(html).toContain('Add to kit');
    expect(html).toContain('no account needed');
  });
});

describe('ListingMedia presentation', () => {
  it('renders a malicious cover SVG as an encoded data-URL image — never inline markup', () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    const html = render(
      React.createElement(ListingMedia, {
        title: 'Evil Cover',
        kind: 'music',
        coverSvg: hostile,
      }),
    );
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<script');
    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain('<img');
  });

  it('rejects unsafe image protocols and falls back to the title tile', () => {
    const html = render(
      React.createElement(ListingMedia, {
        title: 'Bad Image',
        kind: 'placement',
        images: ['javascript:alert(1)', 'http://insecure.example.com/x.png'],
      }),
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('http://insecure');
    expect(html).toContain('Bad Image');
  });

  it('renders audio with preload=none and no autoplay', () => {
    const html = render(
      React.createElement(ListingMedia, {
        title: 'Track',
        kind: 'music',
        audioPath: 'data/uploads/song.mp3',
      }),
    );
    expect(html).toContain('preload="none"');
    expect(html).not.toContain('autoplay');
    expect(html).toContain('/api/v1/uploads/song.mp3');
  });
});
