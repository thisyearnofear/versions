// MODULAR: Static demo catalog — the landing hero's offline fallback.
//
// When the catalog DB (Neon) is unreachable, the hero degrades to these
// hardcoded beachhead rows instead of an empty "unreachable" panel. The
// rows mirror `scripts/seed-marketplace.ts` (same titles/tags/tiers) so the
// demo tells the same story as the live product: one unified listing
// primitive (music + product placements) → matched to a channel's vibe →
// used free with credit or bought as a paid slot → settled 60/30/10.
//
// CLAIM DISCIPLINE: everything here is demo-labeled. Rows never claim
// `verified` reach, `platform_api` stats, or `settled` legs — those only
// exist on the live rails. The UI must render the DEMO badge and route
// CTAs to /discover + /submit (the live doors), never to a fake checkout.

import type { MarketplaceListing } from './marketplace-client';
import { generateRatingCover, type RatingCoverInput } from './cover-gen';

export interface DemoChannel {
  id: string;
  name: string;
  niche: string;
  query: string;
}

export const DEMO_CHANNELS: DemoChannel[] = [
  { id: 'demo-lofi-girl', name: 'Lofi Study Radio', niche: 'lo-fi study streams', query: 'lo-fi study calm instrumental' },
  { id: 'demo-morning', name: 'Morning Brew Crew', niche: 'morning routine vlogs', query: 'coffee morning bright upbeat' },
  { id: 'demo-nightdrive', name: 'Midnight Mile', niche: 'night-drive mixes', query: 'night drive warm electronic' },
];

function demoListing(
  partial: Partial<MarketplaceListing> &
    Pick<MarketplaceListing, 'id' | 'kind' | 'title' | 'supplier_name' | 'summary' | 'tags' | 'tier'> & {
      cover?: Omit<RatingCoverInput, 'title' | 'moodTags'>;
    },
): MarketplaceListing {
  const free = partial.tier === 'free';
  const { cover, ...fields } = partial;
  return {
    supplier_wallet: '0x0000000000000000000000000000000000000000',
    submission_id: null,
    images: [],
    // Generated cover art — deterministic per title via cover-gen, same
    // pipeline live submissions use. Keeps the demo stage visual instead
    // of an empty title tile; still demo-labeled by the UI.
    cover_svg: generateRatingCover({ title: fields.title, moodTags: fields.tags, ...cover }),
    audio_path: null,
    pricing: free ? null : { model: 'flat', flatFeeUsdc: '3.00' },
    budget_cap_usdc: null,
    budget_remaining_usdc: null,
    budget_spent_usdc: '0',
    disclosure: free ? null : { label: 'Paid placement', statement: 'The channel is paid to feature this product.' },
    attribution_text: `Music: ${partial.title} by ${partial.supplier_name} — via VERSIONS`,
    attribution_url: `https://versions.persidian.com/t/${partial.id.slice(0, 8)}`,
    attribution_slug: partial.id.slice(0, 8),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fit_score: 0.9,
    why_fits: (partial.tags ?? []).slice(0, 2),
    similarity: null,
    ...fields,
  } as MarketplaceListing;
}

export const DEMO_LISTINGS: MarketplaceListing[] = [
  demoListing({
    id: 'demo-midnight-study', kind: 'music', title: 'Midnight Study Session', supplier_name: 'Luna Rivera',
    summary: 'Lo-fi tape loop for late-night focus. 84 bpm, vinyl crackle, no vocals.',
    tags: ['lo-fi', 'study', 'focus', 'night drive', 'analog'], tier: 'free',
    cover: { valence: 'dark', tempo: 'dragging' },
  }),
  demoListing({
    id: 'demo-neon-after', kind: 'music', title: 'Neon After Hours', supplier_name: 'The Night Shift',
    summary: 'Synthwave-tinted lo-fi, steady pulse for night driving.',
    tags: ['lo-fi', 'night drive', 'midnight', 'chill', 'synth'], tier: 'free',
    cover: { valence: 'dark', tempo: 'rushing', energy: 'higher' },
  }),
  demoListing({
    id: 'demo-paper-lanterns', kind: 'music', title: 'Paper Lanterns', supplier_name: 'Paper Birds',
    summary: 'Fingerpicked guitar + soft pad, sunrise focus.',
    tags: ['ambient', 'study', 'focus', 'acoustic', 'chill'], tier: 'free',
    cover: { valence: 'bright', tempo: 'locked' },
  }),
  demoListing({
    id: 'demo-warm-tape', kind: 'placement', title: 'Warm Tape — Analog Plugin', supplier_name: 'Fable Audio',
    summary: 'Saturation plugin for dusty drums and glued mixes. Free trial.',
    tags: ['lo-fi', 'analog', 'focus', 'production'], tier: 'paid',
    attribution_text: 'Featured: Warm Tape — Analog Plugin by Fable Audio — via VERSIONS. Paid placement — The channel is paid to feature this product.',
    cover: { tempo: 'locked', energy: 'same' },
  }),
  demoListing({
    id: 'demo-headphone-stand', kind: 'placement', title: 'Walnut Headphone Stand', supplier_name: 'Analog & Oak',
    summary: 'Hand-oiled walnut stand for studio headphones. Ships flat.',
    tags: ['studio', 'analog', 'chill', 'desk'], tier: 'paid',
    attribution_text: 'Featured: Walnut Headphone Stand by Analog & Oak — via VERSIONS. Paid placement — The channel is paid to feature this product.',
  }),
  demoListing({
    id: 'demo-city-rain', kind: 'music', title: 'City Rain Window', supplier_name: 'Field Notes Club',
    summary: 'Soft piano under sampled rainfall. Made for reading.',
    tags: ['ambient', 'study', 'calm', 'instrumental'], tier: 'free',
    cover: { valence: 'dark', tempo: 'dragging', energy: 'lower' },
  }),
];

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'with', 'is', 'on']);

/** Tag-overlap rank of the static demo rows — same token rule as the API's tag fallback. */
export function rankDemoListings(query: string, limit = 4): MarketplaceListing[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9-]+/).filter((t) => t.length >= 2 && !STOP.has(t));
  const scored = DEMO_LISTINGS.map((l) => {
    const hay = new Set([...l.tags.map((t) => t.toLowerCase()), ...l.title.toLowerCase().split(/[^a-z0-9-]+/)]);
    let hits = 0;
    for (const t of tokens) if (hay.has(t)) hits++;
    return { l, score: hits };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s, i) => ({ ...s.l, fit_score: Math.max(0.4, 0.95 - i * 0.08) }));
}
