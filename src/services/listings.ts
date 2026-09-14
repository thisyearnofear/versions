// MODULAR: Listings — the unified supply side of the marketplace.
//
// ONE primitive, TWO catalogs. A listing is a slot in a feed that a
// distribution channel can pick up: `music` (a track, linked to an existing
// submission so the upload pipeline is reused) or `placement` (a brand/product
// with its own creative). Both are matched against channel ethos in the same
// vector space, both are either free-with-attribution or paid, and both settle
// through the same flat three-way split.
//
// CLEAN: there is deliberately no per-listing licensing negotiation, no
// consent policy, and no curation gate. One blanket agreement is accepted once
// at creation (`src/lib/agreement.ts`), attribution is generated rather than
// requested (`src/lib/attribution.ts`), and a listing goes live immediately —
// matching ranks supply for discovery, it does not gatekeep publication.
//
// SAFE: a `music` listing may only be created against a submission the calling
// wallet actually owns, so a supplier cannot list someone else's track. Prices
// are parsed through the settlement module's own micro-USDC reader rather than
// a second, looser validator, so the money format has one source of truth.

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  listings as listingsTable,
  submissions as submissionsTable,
  users as usersTable,
} from '../lib/schema';
import { fromMicroUsdc, toMicroUsdc } from './settlement';
import { AGREEMENT_VERSION, isCurrentAgreementVersion } from '../lib/agreement';
import {
  buildAttribution,
  disclosureForTier,
  type Attribution,
} from '../lib/attribution';
import { log } from '../lib/logger';
import type {
  AudioFeatures,
  Disclosure,
  ListingKind,
  ListingPricing,
  ListingStatus,
  ListingTier,
} from '../lib/types';

export const MAX_LISTING_TAGS = 12;
export const MAX_TAG_LEN = 40;
export const MAX_LISTING_IMAGES = 8;

export interface ListingRecord {
  id: string;
  kind: ListingKind;
  supplier_wallet: string;
  submission_id: string | null;
  title: string;
  supplier_name: string;
  summary: string | null;
  tags: string[];
  images: string[];
  cover_svg: string | null;
  audio_path: string | null;
  audio_features: AudioFeatures | null;
  tier: ListingTier;
  pricing: ListingPricing | null;
  budget_cap_usdc: string | null;
  budget_spent_usdc: string;
  /** Remaining budget, or null when uncapped. What a buyer actually sees. */
  budget_remaining_usdc: string | null;
  disclosure: Disclosure | null;
  attribution_text: string;
  attribution_url: string;
  attribution_slug: string;
  agreement_version: string;
  status: ListingStatus;
  created_at: string;
  updated_at: string;
}

export type ListingFailureCode =
  | 'AGREEMENT_VERSION_STALE'
  | 'INVALID_TITLE'
  | 'INVALID_TAGS'
  | 'SUBMISSION_REQUIRED'
  | 'SUBMISSION_NOT_FOUND'
  | 'SUBMISSION_NOT_OWNED'
  | 'IMAGES_REQUIRED'
  | 'INVALID_PRICING'
  | 'INVALID_BUDGET'
  | 'LISTING_NOT_FOUND';

export type ListingResult =
  | { ok: true; listing: ListingRecord }
  | { ok: false; code: ListingFailureCode; message: string };

export interface CreateListingInput {
  supplierWallet: string;
  kind: ListingKind;
  title: string;
  supplierName: string;
  summary?: string | null;
  tags: string[];
  images?: string[];
  /** Music only — the uploaded track this listing offers. */
  submissionId?: string | null;
  tier: ListingTier;
  /** Paid only. Free listings must omit it. */
  pricing?: ListingPricing | null;
  /** Paid only. Null means uncapped. */
  budgetCapUsdc?: string | null;
  agreementVersion: string;
}

export interface ListingsService {
  create(input: CreateListingInput): Promise<ListingResult>;
  get(listingId: string): Promise<ListingRecord | null>;
  listForSupplier(wallet: string, opts?: { limit?: number }): Promise<ListingRecord[]>;
  /** Live supply, optionally filtered to one catalog. What channels browse. */
  listActive(opts?: { kind?: ListingKind; limit?: number; offset?: number }): Promise<ListingRecord[]>;
  /** Supplier control: pause, resume, archive. Ends future use, not past use. */
  setStatus(listingId: string, wallet: string, status: ListingStatus): Promise<ListingResult>;
}

type ListingRow = typeof listingsTable.$inferSelect;

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function decimalUsdc(value: string): bigint | null {
  try {
    const micro = toMicroUsdc(value);
    return micro >= 0n ? micro : null;
  } catch {
    return null;
  }
}

function toRecord(row: ListingRow): ListingRecord {
  const cap = row.budgetCapUsdc ? decimalUsdc(row.budgetCapUsdc) : null;
  const spent = decimalUsdc(row.budgetSpentUsdc) ?? 0n;
  return {
    id: row.id,
    kind: row.kind,
    supplier_wallet: row.supplierWallet,
    submission_id: row.submissionId,
    title: row.title,
    supplier_name: row.supplierName,
    summary: row.summary,
    tags: row.tags ?? [],
    images: row.images ?? [],
    cover_svg: row.coverSvg,
    audio_path: row.audioPath,
    audio_features: row.audioFeatures ?? null,
    tier: row.tier,
    pricing: row.pricing ?? null,
    budget_cap_usdc: row.budgetCapUsdc,
    budget_spent_usdc: row.budgetSpentUsdc,
    budget_remaining_usdc: cap === null ? null : fromMicroUsdc(cap > spent ? cap - spent : 0n),
    disclosure: row.disclosure ?? null,
    attribution_text: row.attributionText,
    attribution_url: row.attributionUrl,
    attribution_slug: row.attributionSlug,
    agreement_version: row.agreementVersion,
    status: row.status,
    created_at: toIso(row.createdAt) ?? '',
    updated_at: toIso(row.updatedAt) ?? '',
  };
}

function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clean || clean.length > MAX_TAG_LEN || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= MAX_LISTING_TAGS) break;
  }
  return out;
}

/**
 * A paid listing must be priceable and a free one must not be — the same rule
 * the schema CHECK enforces, checked here first so the caller gets a useful
 * message instead of a constraint violation.
 */
function validatePricing(
  tier: ListingTier,
  pricing: ListingPricing | null | undefined,
): { ok: true; pricing: ListingPricing | null } | { ok: false; message: string } {
  if (tier === 'free') {
    if (pricing) return { ok: false, message: 'A free listing cannot carry a price — set tier to paid.' };
    return { ok: true, pricing: null };
  }
  if (!pricing) return { ok: false, message: 'A paid listing needs a price.' };
  if (pricing.model === 'flat') {
    const fee = pricing.flatFeeUsdc ? decimalUsdc(pricing.flatFeeUsdc) : null;
    if (fee === null || fee <= 0n) {
      return { ok: false, message: 'flatFeeUsdc must be a positive decimal USDC amount.' };
    }
    return { ok: true, pricing: { model: 'flat', flatFeeUsdc: fromMicroUsdc(fee) } };
  }
  if (pricing.model === 'cpm') {
    const cpm = pricing.cpmUsdc ? decimalUsdc(pricing.cpmUsdc) : null;
    if (cpm === null || cpm <= 0n) {
      return { ok: false, message: 'cpmUsdc must be a positive decimal USDC amount per 1000 impressions.' };
    }
    return { ok: true, pricing: { model: 'cpm', cpmUsdc: fromMicroUsdc(cpm) } };
  }
  return { ok: false, message: "pricing.model must be 'flat' or 'cpm'." };
}

export function createListingsService(): ListingsService {
  async function ensureUser(wallet: string) {
    const now = new Date();
    await db
      .insert(usersTable)
      .values({ id: randomUUID(), walletAddress: wallet, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: usersTable.walletAddress });
  }

  async function fetchById(listingId: string): Promise<ListingRow | null> {
    const [row] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, listingId))
      .limit(1);
    return row ?? null;
  }

  const service: ListingsService = {
    async create(input) {
      if (!isCurrentAgreementVersion(input.agreementVersion)) {
        return {
          ok: false,
          code: 'AGREEMENT_VERSION_STALE',
          message: `The agreement has been updated (current: ${AGREEMENT_VERSION}) — reload and accept the current terms.`,
        };
      }

      const title = input.title.trim();
      if (title.length < 1 || title.length > 200) {
        return { ok: false, code: 'INVALID_TITLE', message: 'A listing needs a title (max 200 characters).' };
      }
      const supplierName = input.supplierName.trim();
      if (supplierName.length < 1 || supplierName.length > 120) {
        return { ok: false, code: 'INVALID_TITLE', message: 'A listing needs an artist or brand name (max 120 characters).' };
      }

      const tags = normalizeTags(input.tags ?? []);
      if (tags.length === 0) {
        return {
          ok: false,
          code: 'INVALID_TAGS',
          message: 'Add at least one tag — tags are what a channel matches against.',
        };
      }

      const supplierWallet = input.supplierWallet.toLowerCase();
      const images = (input.images ?? []).map((u) => u.trim()).filter(Boolean).slice(0, MAX_LISTING_IMAGES);

      let submissionId: string | null = null;
      let audioPath: string | null = null;
      let coverSvg: string | null = null;
      let audioFeatures: AudioFeatures | null = null;

      if (input.kind === 'music') {
        if (!input.submissionId) {
          return { ok: false, code: 'SUBMISSION_REQUIRED', message: 'A music listing must reference an uploaded track.' };
        }
        const [sub] = await db
          .select()
          .from(submissionsTable)
          .where(eq(submissionsTable.id, input.submissionId))
          .limit(1);
        if (!sub) {
          return { ok: false, code: 'SUBMISSION_NOT_FOUND', message: 'No submission with that id.' };
        }
        // Ownership is checked here rather than trusted from the client: a
        // supplier must not be able to list someone else's track.
        if (sub.artistWallet.toLowerCase() !== supplierWallet) {
          return { ok: false, code: 'SUBMISSION_NOT_OWNED', message: 'That track belongs to another wallet.' };
        }
        submissionId = sub.id;
        audioPath = sub.audioPath;
        coverSvg = sub.coverSvg;
        audioFeatures = sub.audioFeatures ?? null;
      } else if (images.length === 0) {
        return { ok: false, code: 'IMAGES_REQUIRED', message: 'A product placement needs at least one image.' };
      }

      const priced = validatePricing(input.tier, input.pricing);
      if (!priced.ok) {
        return { ok: false, code: 'INVALID_PRICING', message: priced.message };
      }

      let budgetCapUsdc: string | null = null;
      if (input.budgetCapUsdc != null && input.budgetCapUsdc !== '') {
        if (input.tier !== 'paid') {
          return { ok: false, code: 'INVALID_BUDGET', message: 'Only a paid listing can carry a budget cap.' };
        }
        const cap = decimalUsdc(input.budgetCapUsdc);
        if (cap === null || cap <= 0n) {
          return { ok: false, code: 'INVALID_BUDGET', message: 'budgetCapUsdc must be a positive decimal USDC amount.' };
        }
        budgetCapUsdc = fromMicroUsdc(cap);
      }

      await ensureUser(supplierWallet);

      const id = randomUUID();
      // Attribution is generated, not requested. The channel is contractually
      // bound to render this string unmodified, and a paid listing's carries
      // the disclosure marker so the sponsored-content obligation travels with
      // the creative instead of depending on the channel remembering it.
      const attribution: Attribution = buildAttribution({
        listingId: id,
        kind: input.kind,
        tier: input.tier,
        title,
        supplierName,
      });
      const disclosure = disclosureForTier(input.tier);
      const now = new Date();

      const [inserted] = await db
        .insert(listingsTable)
        .values({
          id,
          kind: input.kind,
          supplierWallet,
          submissionId,
          title,
          supplierName,
          summary: input.summary?.trim() || null,
          tags,
          images,
          coverSvg,
          audioPath,
          audioFeatures,
          tier: input.tier,
          pricing: priced.pricing,
          budgetCapUsdc,
          budgetSpentUsdc: '0',
          disclosure,
          attributionText: attribution.text,
          attributionUrl: attribution.url,
          attributionSlug: attribution.slug,
          agreementVersion: input.agreementVersion,
          agreementAcceptedAt: now,
          // Live on creation. There is no curation queue: matching ranks
          // supply for discovery, it does not gatekeep publication.
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      log.info('listing created', {
        listingId: id,
        kind: input.kind,
        tier: input.tier,
        tags: tags.length,
      });
      return { ok: true, listing: toRecord(inserted) };
    },

    async get(listingId) {
      const row = await fetchById(listingId);
      return row ? toRecord(row) : null;
    },

    async listForSupplier(wallet, { limit = 50 } = {}) {
      const rows = await db
        .select()
        .from(listingsTable)
        .where(eq(listingsTable.supplierWallet, wallet.toLowerCase()))
        .orderBy(desc(listingsTable.createdAt))
        .limit(Math.min(Math.max(1, limit), 100));
      return rows.map(toRecord);
    },

    async listActive({ kind, limit = 50, offset = 0 } = {}) {
      const rows = await db
        .select()
        .from(listingsTable)
        .where(kind ? and(eq(listingsTable.status, 'active'), eq(listingsTable.kind, kind)) : eq(listingsTable.status, 'active'))
        .orderBy(desc(listingsTable.createdAt))
        .limit(Math.min(Math.max(1, limit), 100))
        .offset(Math.max(0, offset));
      return rows.map(toRecord);
    },

    async setStatus(listingId, wallet, status) {
      const row = await fetchById(listingId);
      if (!row) {
        return { ok: false, code: 'LISTING_NOT_FOUND', message: 'No listing with that id.' };
      }
      if (row.supplierWallet.toLowerCase() !== wallet.toLowerCase()) {
        return { ok: false, code: 'LISTING_NOT_FOUND', message: 'No listing with that id.' };
      }
      const [updated] = await db
        .update(listingsTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(listingsTable.id, listingId))
        .returning();
      return { ok: true, listing: toRecord(updated ?? row) };
    },
  };

  return service;
}
