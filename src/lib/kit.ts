// MODULAR: The guest kit — the only thing a visitor keeps without an
// account. docs/interface.md §4.3/§4.4 rung 3: a browse session must end
// with the visitor holding something (a shortlist + the exact credit line +
// media links), not a one-off clipboard copy, and it must work with no
// wallet and no network.
//
// DELIBERATELY REACT-FREE: this module is also read from server code and
// from pure unit tests, so it holds no hooks. The React binding lives in
// src/lib/use-kit.ts.
//
// CLAIM DISCIPLINE (docs/interface.md §4.7, STRATEGY.md §2):
//   • Copying a credit is NOT a use — nothing here logs, reports, or
//     "verifies" anything. Only POST /api/v1/usage does that.
//   • A PAID placement's credit is never carried. The attribution (with its
//     #ad disclosure) is issued to a channel when the slot is bought, so a
//     kit can only ever shortlist a paid listing — never hand over the
//     creative. `sanitizeKitItem` enforces that, so a hand-edited
//     localStorage entry cannot smuggle one in either.
//
// Storage is best-effort: private mode / storage-disabled browsers fall
// back to an in-memory kit for the visit (same guard style as
// src/lib/guest-id.ts).

import {
  listingPriceBadge,
  mediaHref,
  uploadAudioHref,
  type MarketplaceListing,
} from "@/lib/marketplace-client";

export type KitKind = "music" | "placement";
export type KitTier = "free" | "paid";

export interface KitMedia {
  label: string;
  href: string;
}

export interface KitItem {
  listingId: string;
  kind: KitKind;
  tier: KitTier;
  title: string;
  supplierName: string;
  /** Card-form price at capture time, e.g. "3.00 USDC flat". */
  priceLabel: string;
  /** Free only. Empty string for paid — see claim discipline above. */
  attributionText: string;
  attributionUrl: string;
  disclosure: { label: string; statement: string } | null;
  media: KitMedia[];
  addedAt: string;
  /** Channel context the visitor was browsing under, if any. */
  channelId: string | null;
}

export const KIT_STORAGE_KEY = "versions.kit.v1";
export const KIT_LIMIT = 50;

const EMPTY: KitItem[] = [];

const MAX_TEXT = 400;
const MAX_URL = 2000;

// ── sanitising ────────────────────────────────────────────

/** Mirror of PublishingKit's safeLinkHref: https or site-relative only. */
export function safeKitHref(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

function text(raw: unknown, max = MAX_TEXT): string {
  return typeof raw === "string" ? raw.slice(0, max) : "";
}

function sanitizeMedia(raw: unknown): KitMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: KitMedia[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const href = safeKitHref((entry as KitMedia).href);
    if (!href) continue;
    out.push({ label: text((entry as KitMedia).label, 40) || "Media", href });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * One stored entry → a usable KitItem, or null when it can't be trusted.
 * Tolerant by design: a corrupt or hand-edited entry is dropped, it never
 * throws and never half-loads.
 */
export function sanitizeKitItem(raw: unknown): KitItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const listingId = text(r.listingId, 120);
  const title = text(r.title, 200);
  if (!listingId || !title) return null;

  const tier: KitTier = r.tier === "paid" ? "paid" : "free";
  const kind: KitKind = r.kind === "placement" ? "placement" : "music";
  const disclosureRaw = r.disclosure as { label?: unknown; statement?: unknown } | null | undefined;

  return {
    listingId,
    kind,
    tier,
    title,
    supplierName: text(r.supplierName, 200),
    priceLabel: text(r.priceLabel, 80),
    // Paid supply carries no credit in a kit — the slot issues it at purchase.
    attributionText: tier === "paid" ? "" : text(r.attributionText, 800),
    attributionUrl: safeKitHref(r.attributionUrl) ?? "",
    disclosure:
      tier === "paid" && disclosureRaw && typeof disclosureRaw === "object"
        ? {
            label: text(disclosureRaw.label, 40) || "#ad",
            statement: text(disclosureRaw.statement, 300),
          }
        : null,
    media: sanitizeMedia(r.media),
    addedAt: text(r.addedAt, 40) || new Date(0).toISOString(),
    channelId: typeof r.channelId === "string" && r.channelId ? r.channelId.slice(0, 120) : null,
  };
}

/** Tolerant list parse: drops junk, de-dupes by listing id, caps the kit. */
export function parseKitItems(raw: unknown): KitItem[] {
  if (!Array.isArray(raw)) return EMPTY;
  const seen = new Set<string>();
  const out: KitItem[] = [];
  for (const entry of raw) {
    const item = sanitizeKitItem(entry);
    if (!item || seen.has(item.listingId)) continue;
    seen.add(item.listingId);
    out.push(item);
    if (out.length >= KIT_LIMIT) break;
  }
  return out;
}

// ── store ─────────────────────────────────────────────────

let cache: KitItem[] | null = null;
let persisted = true;
let storageListenerBound = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): KitItem[] {
  const store = storage();
  if (!store) {
    persisted = false;
    return EMPTY;
  }
  try {
    const raw = store.getItem(KIT_STORAGE_KEY);
    persisted = true;
    return raw ? parseKitItems(JSON.parse(raw)) : EMPTY;
  } catch {
    // Corrupt JSON — treat as an empty kit rather than throwing on boot.
    persisted = false;
    return EMPTY;
  }
}

function setCache(next: KitItem[]): void {
  cache = next;
  for (const listener of listeners) listener();
}

function persist(items: KitItem[]): void {
  const store = storage();
  if (!store) {
    persisted = false;
    return;
  }
  try {
    store.setItem(KIT_STORAGE_KEY, JSON.stringify(items));
    persisted = true;
  } catch {
    persisted = false;
  }
}

/**
 * Stable snapshot for useSyncExternalStore — the SAME array reference until
 * the kit actually changes (a fresh array per call re-renders forever).
 */
export function getKitSnapshot(): KitItem[] {
  if (cache === null) cache = load();
  return cache;
}

/** SSR/first-paint snapshot: an empty kit, never a storage read. */
export function getKitServerSnapshot(): KitItem[] {
  return EMPTY;
}

/** Re-read storage (cross-tab sync + tests). */
export function reloadKit(): KitItem[] {
  const next = load();
  setCache(next);
  return next;
}

export function isKitPersisted(): boolean {
  return persisted;
}

export function subscribeToKit(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerBound && typeof window !== "undefined") {
    storageListenerBound = true;
    // `storage` only fires for OTHER tabs — exactly the sync we want.
    window.addEventListener("storage", (event) => {
      if (event.key !== KIT_STORAGE_KEY && event.key !== null) return;
      reloadKit();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Adds (or refreshes) an item. Newest first; no duplicates. */
export function addKitItem(item: KitItem): KitItem[] {
  const current = getKitSnapshot();
  const next = [item, ...current.filter((i) => i.listingId !== item.listingId)].slice(0, KIT_LIMIT);
  persist(next);
  setCache(next);
  return next;
}

export function removeKitItem(listingId: string): KitItem[] {
  const next = getKitSnapshot().filter((i) => i.listingId !== listingId);
  persist(next);
  setCache(next);
  return next;
}

export function clearKit(): KitItem[] {
  persist(EMPTY);
  setCache(EMPTY);
  return EMPTY;
}

// ── capture ───────────────────────────────────────────────

/**
 * Snapshot a listing into a kit item at capture time, so the kit still
 * works when the catalog is unreachable. Paid listings deliberately keep
 * no credit and no media (the creative is issued with the slot).
 */
export function kitItemFromListing(
  listing: MarketplaceListing,
  channelId: string | null = null,
  now: Date = new Date(),
): KitItem {
  const paid = listing.tier === "paid";
  const media: KitMedia[] = [];
  if (!paid && listing.audio_path) {
    media.push({ label: "Audio file", href: uploadAudioHref(listing.audio_path) });
  }
  if (!paid) {
    for (const raw of listing.images ?? []) {
      const href = mediaHref(raw);
      if (href) media.push({ label: `Image ${media.length + 1}`, href });
    }
  }

  return {
    listingId: listing.id,
    kind: listing.kind,
    tier: paid ? "paid" : "free",
    title: listing.title,
    supplierName: listing.supplier_name,
    priceLabel: listingPriceBadge(listing),
    attributionText: paid ? "" : listing.attribution_text,
    attributionUrl: listing.attribution_url,
    disclosure: paid ? listing.disclosure ?? null : null,
    media,
    addedAt: now.toISOString(),
    channelId,
  };
}

// ── selection + text ──────────────────────────────────────

export function kitFreeItems(items: KitItem[]): KitItem[] {
  return items.filter((i) => i.tier === "free");
}

export function kitPaidItems(items: KitItem[]): KitItem[] {
  return items.filter((i) => i.tier === "paid");
}

/** The credit lines a visitor may actually render today (free supply). */
export function kitCreditsText(items: KitItem[]): string {
  return kitFreeItems(items)
    .map((i) => i.attributionText.trim())
    .filter(Boolean)
    .join("\n");
}

export function kitListingHref(item: KitItem): string {
  return item.channelId
    ? `/listings/${item.listingId}?channelId=${encodeURIComponent(item.channelId)}`
    : `/listings/${item.listingId}`;
}

/**
 * The exportable kit. Free items ship ready to publish (credit + links);
 * paid items are a shortlist with a reserve link and NO credit — issuing
 * that is the purchase's job, not the kit's.
 */
export function kitExportText(
  items: KitItem[],
  opts: { exportedAt?: Date; siteOrigin?: string } = {},
): string {
  const free = kitFreeItems(items);
  const paid = kitPaidItems(items);
  const origin = (opts.siteOrigin ?? "").replace(/\/$/, "");
  const url = (href: string) => (href.startsWith("/") ? `${origin}${href}` : href);

  const lines: string[] = [
    `VERSIONS kit — ${items.length} listing${items.length === 1 ? "" : "s"} (${free.length} free, ${paid.length} paid)`,
    `Exported ${(opts.exportedAt ?? new Date()).toISOString()}`,
    "Copying a credit does not log a use — report where it ran from the listing page.",
  ];

  if (free.length > 0) {
    lines.push("", "── FREE · ready to publish ─────────────────────────");
    free.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title} — ${item.supplierName}`, "   Credit (render exactly as written):");
      lines.push(`   ${item.attributionText.trim()}`);
      if (item.disclosure) {
        lines.push(`   Disclosure: ${item.disclosure.label} — ${item.disclosure.statement}`);
      }
      lines.push(`   Listing: ${url(kitListingHref(item))}`);
      for (const m of item.media) lines.push(`   ${m.label}: ${url(m.href)}`);
    });
  }

  if (paid.length > 0) {
    lines.push("", "── PAID · not purchased yet ───────────────────────");
    paid.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.title} — ${item.supplierName} — ${item.priceLabel || "paid placement"}`,
        "   Not purchased — reserve this placement before publishing.",
        `   Reserve: ${url(kitListingHref(item))}`,
      );
    });
  }

  return `${lines.join("\n")}\n`;
}
