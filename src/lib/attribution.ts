// MODULAR: Attribution and disclosure generation. Pure module — no I/O.
//
// Attribution is enforced at the PRODUCT level rather than asked for as a
// favour: every listing gets a generated credit string plus a link back, in
// the NCS style, and a channel that takes a free listing is contractually
// bound to render it unmodified. Paid listings additionally get a unique
// tracking code so impressions and clicks are attributable back to the slot,
// and a disclosure marker so the sponsored-content obligation travels with
// the creative instead of depending on the channel remembering it.

import { createHash, randomBytes } from 'crypto';
import type { Disclosure, ListingKind, ListingTier } from './types';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://versions.persidian.com').replace(/\/$/, '');

/** Path of a listing's public attribution page — the "link back". */
export function listingPath(listingId: string): string {
  return `/listings/${listingId}`;
}

export function attributionUrl(listingId: string, baseUrl: string = APP_URL): string {
  return `${baseUrl}${listingPath(listingId)}`;
}

/**
 * Short, stable, URL-safe handle derived from the listing id + title. Used in
 * tracking links and attribution codes. Deterministic so the same listing
 * always produces the same slug (regenerating it would break every credit
 * string already published in the wild).
 */
export function attributionSlug(listingId: string, title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
  // The id suffix keeps the slug unique without needing a retry loop when two
  // suppliers happen to title their listings identically.
  const suffix = listingId.slice(0, 8);
  return words ? `${words}-${suffix}` : suffix;
}

/**
 * Unique trackable identifier for a paid slot. Opaque and unguessable — it
 * appears in public URLs, so it must not encode the slot id or be enumerable.
 */
export function newTrackingCode(): string {
  return `vs_${randomBytes(12).toString('base64url')}`;
}

export function trackingUrl(code: string, baseUrl: string = APP_URL): string {
  return `${baseUrl}/t/${code}`;
}

/**
 * The attribution code a channel reports against. Binds the listing slug to
 * the slot's tracking code so a reported play can be matched to the campaign
 * that paid for it.
 */
export function attributionCodeFor(slug: string, trackingCode: string): string {
  return `${slug}:${trackingCode}`;
}

// ── Disclosure (compliance surface) ───────────────────
// Paid placements must carry a disclosure marker in whatever attribution or
// metadata is generated. FTC guidance and the platforms' own
// sponsored-content rules apply to AI-run channels exactly as they do to
// human ones, so the marker is produced here and stamped onto the listing and
// every slot bought against it — never left for the channel to add.

export function sponsoredDisclosure(): Disclosure {
  return {
    kind: 'sponsored',
    label: '#ad',
    statement: 'Sponsored placement arranged through VERSIONS.',
  };
}

export function paidPromotionDisclosure(): Disclosure {
  return {
    kind: 'paid_promotion',
    label: 'Paid promotion',
    statement: 'This content includes a paid promotion arranged through VERSIONS.',
  };
}

/**
 * Disclosure is mandatory for paid supply and forbidden for free supply.
 * Returning null for `free` is what makes the schema CHECK
 * (`tier = 'paid') = (disclosure IS NOT NULL`) satisfiable in both directions.
 */
export function disclosureForTier(tier: ListingTier): Disclosure | null {
  return tier === 'paid' ? sponsoredDisclosure() : null;
}

// ── Attribution string ────────────────────────────────

export interface AttributionInput {
  listingId: string;
  kind: ListingKind;
  tier: ListingTier;
  title: string;
  supplierName: string;
  disclosure?: Disclosure | null;
  baseUrl?: string;
}

export interface Attribution {
  slug: string;
  url: string;
  /** The credit string the channel must render, unmodified. */
  text: string;
  /** Plain-credit variant for description fields with no rich text. */
  credit: string;
}

/**
 * Build the generated credit. Music reads like an NCS release credit; a
 * placement reads like a product credit. When a disclosure is present it is
 * appended to BOTH variants so the sponsored marker cannot be dropped by
 * choosing the shorter string.
 */
export function buildAttribution(input: AttributionInput): Attribution {
  const { listingId, kind, title, supplierName, baseUrl } = input;
  const slug = attributionSlug(listingId, title);
  const url = attributionUrl(listingId, baseUrl);
  const disclosure = input.disclosure ?? disclosureForTier(input.tier);

  const noun = kind === 'music' ? 'Music' : 'Featured';
  const credit = `${noun}: ${title} by ${supplierName} — via VERSIONS ${url}`;
  const suffix = disclosure ? ` ${disclosure.label} — ${disclosure.statement}` : '';

  return {
    slug,
    url,
    credit,
    text: `${credit}${suffix}`,
  };
}

/**
 * Stable hash of an attribution string. Lets a compliance check compare what
 * a channel actually published against what was generated without storing the
 * whole rendered page.
 */
export function attributionHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
