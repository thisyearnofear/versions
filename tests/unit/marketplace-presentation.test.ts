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

import { PublishingKit } from '@/components/marketplace/PublishingKit';
import { ListingMedia } from '@/components/marketplace/ListingMedia';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

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
