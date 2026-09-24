// MODULAR: Marketplace search — ethos-personalized ranking of listings.
//
// The marketplace is one vector space where both supply kinds (music +
// placement) and demand ethos (channels) are embedded with the SAME
// adapter. A channel's recent titles + niche describe what it actually
// publishes; a listing's title + tags + summary describe what the slot
// offers. Cosine closeness = fit. That is the whole inversion: instead of
// a supervisor pasting a brief against a track catalog, a channel's own
// content ranks supply.
//
// SAFE: channel reach is never compared here — ethos text is the ranking
// input, verified subscriber counts are the eligibility gate (checked by
// the slots service, not here).
//
// PERFORMANT: tries pgvector first (when embeddings exist and the driver
// is real), falls back to tag-overlap scoring so browse works with zero
// external dependencies, in mock, and in PGlite tests. Cached per key
// like feed.searchByBrief — feed-update invalidates the marketplace keys
// too.

import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  listings as listingsTable,
  listingEmbeddings as listingEmbTable,
  channels as channelsTable,
  channelEmbeddings as channelEmbTable,
} from '../lib/schema';
import { cached } from '../lib/cache';
import { createEmbeddingAdapter, type EmbeddingAdapter } from '../adapters/embedding';
import { buildChannelEmbedText, buildListingEmbedText } from '../lib/catalog-embed-text';
import { buildChannelEthosText } from './channels';
import { log } from '../lib/logger';
import type { ListingKind, ListingTier } from '../lib/types';

/** Sort keys for browse. `fit` (default) keeps the ranking order intact. */
export type MarketplaceSort = 'fit' | 'newest' | 'price_asc' | 'price_desc';

/**
 * Facet counts over the match slice, computed BEFORE the kind/tier facets
 * are applied — so an active facet never collapses its own group counts
 * (standard marketplace behaviour: the shelf keeps telling you what's in
 * the other groups while you filter). `total` here is the facet-free
 * count; the result's top-level `total` is the post-facet count paging uses.
 */
export interface MarketplaceCounts {
  total: number;
  music: number;
  placement: number;
  free: number;
  paid: number;
}

export interface MarketplaceSearchArgs {
  query?: string | null;
  channelId?: string | null;
  kind?: ListingKind | null;
  tier?: ListingTier | null;
  sort?: MarketplaceSort | null;
  tags?: string[] | null;
  limit?: number;
  offset?: number;
}

export interface MarketplaceRow {
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
  tier: ListingTier;
  pricing: ListingKind extends never ? never : unknown;
  budget_cap_usdc: string | null;
  budget_remaining_usdc: string | null;
  budget_spent_usdc: string;
  disclosure: unknown;
  attribution_text: string;
  attribution_url: string;
  attribution_slug: string;
  status: string;
  created_at: string;
  fit_score: number;
  why_fits: string[];
  similarity: number | null;
}

export interface MarketplaceSearchResult {
  total: number;
  limit: number;
  offset: number;
  mode: 'semantic' | 'tag' | 'recent';
  rows: MarketplaceRow[];
  /** Facet counts for the match slice (pre kind/tier facets). */
  counts?: MarketplaceCounts;
  /** Sort actually applied (normalised; `fit` when unset). */
  sort?: MarketplaceSort;
  /** Present when the route served a degraded empty result (DB unreachable). */
  degraded?: boolean;
}

const CACHE_TTL_MS = 30_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const STOP = new Set([
  'the','a','an','and','or','of','to','for','in','with','is','it','this','that','as','at','by','on','be','are','was','were','but','not','have','has','had','do','does','did','will','would','should','could','can','i','me','my','we','our','you','your','they','their','them','its','if','so','no','yes','just','than','then','now','here','there','about','into','from','out','up','down','over','under','again','more','some','any','all','each','few','most','other','such','only','own','same','very','too','also',
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  const stripped = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  const words = stripped.split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));
  return Array.from(new Set(words)).slice(0, 30);
}

function ethosTokensForChannel(row: typeof channelsTable.$inferSelect): string[] {
  const text = buildChannelEthosText(row);
  return tokenize(text);
}

function scoreTagOverlap(listingTags: string[], tokens: string[]): { score: number; hits: string[] } {
  if (tokens.length === 0) return { score: 0, hits: [] };
  const hits: string[] = [];
  let score = 0;
  const tagSet = listingTags.map((t) => t.toLowerCase());
  for (const tok of tokens) {
    const matched = tagSet.find((tag) => tag.includes(tok) || (tok.length >= 4 && tok.includes(tag)) || tag === tok);
    if (matched) { score += 2; hits.push(matched); }
  }
  // summary/tag bonus: exact tag hit is stronger than partial
  return { score, hits };
}

function explainTagHits(hits: string[]): string[] {
  return hits.slice(0, 2).map((h) => `tag: ${h}`);
}

function marketplaceCacheKey(args: MarketplaceSearchArgs): string {
  const parts = [
    (args.query || '').trim().toLowerCase().slice(0, 120),
    args.channelId || '',
    args.kind || '',
    args.tier || '',
    normalizeMarketplaceSort(args.sort),
    (args.tags || []).join(','),
    String(args.limit ?? DEFAULT_LIMIT),
    String(args.offset ?? 0),
  ];
  return `marketplace:${parts.join('|')}`;
}

function normalizeMarketplaceSort(raw: MarketplaceSort | null | undefined): MarketplaceSort {
  return raw === 'newest' || raw === 'price_asc' || raw === 'price_desc' ? raw : 'fit';
}

/** Facet counts over the match slice, before the kind/tier facets apply. */
function countsFor(items: Array<{ kind: string; tier: string }>): MarketplaceCounts {
  const counts: MarketplaceCounts = { total: items.length, music: 0, placement: 0, free: 0, paid: 0 };
  for (const item of items) {
    if (item.kind === 'music') counts.music += 1;
    else if (item.kind === 'placement') counts.placement += 1;
    if (item.tier === 'free') counts.free += 1;
    else if (item.tier === 'paid') counts.paid += 1;
  }
  return counts;
}

/**
 * Numeric price for sorting. Free supply counts as 0 so `price_asc`
 * surfaces the free tier first — the wedge, deliberately.
 */
function priceValue(tier: string, pricing: unknown): number {
  if (tier !== 'paid') return 0;
  const p = pricing as { model?: string; flatFeeUsdc?: string; cpmUsdc?: string } | null;
  if (!p) return 0;
  const n = Number(p.model === 'cpm' ? p.cpmUsdc : p.flatFeeUsdc);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Apply the requested sort to already-ranked rows. `fit` is a no-op: the
 * ranking paths hand over fit order, and only explicit sorts reorder.
 * A newest-first tiebreak keeps paging deterministic across offsets.
 */
function sortMarketplaceRows(rows: MarketplaceRow[], sort: MarketplaceSort): MarketplaceRow[] {
  if (sort === 'fit') return rows;
  const byNewest = (a: MarketplaceRow, b: MarketplaceRow) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '');
  const sorted = [...rows];
  if (sort === 'newest') {
    sorted.sort(byNewest);
    return sorted;
  }
  sorted.sort((a, b) => {
    const av = priceValue(a.tier, a.pricing);
    const bv = priceValue(b.tier, b.pricing);
    if (av !== bv) return sort === 'price_asc' ? av - bv : bv - av;
    return byNewest(a, b);
  });
  return sorted;
}

function finalizeMarketplace(opts: {
  rows: MarketplaceRow[];
  counts: MarketplaceCounts;
  mode: MarketplaceSearchResult['mode'];
  sort: MarketplaceSort;
  limit: number;
  offset: number;
}): MarketplaceSearchResult {
  const ordered = sortMarketplaceRows(opts.rows, opts.sort);
  return {
    total: ordered.length,
    limit: opts.limit,
    offset: opts.offset,
    mode: opts.mode,
    counts: opts.counts,
    sort: opts.sort,
    rows: ordered.slice(opts.offset, opts.offset + opts.limit),
  };
}

export function createMarketplaceService(opts?: { embedding?: EmbeddingAdapter }) {
  const embedding = opts?.embedding || createEmbeddingAdapter();

  async function semanticSearch(opts: {
    queryVec: number[];
    kind: ListingKind | null | undefined;
    tier: ListingTier | null | undefined;
    sort: MarketplaceSort;
    limit: number;
    offset: number;
    tokens: string[];
  }): Promise<MarketplaceSearchResult | null> {
    if (embedding.mock) return null;
    try {
      const vecStr = `[${opts.queryVec.map((v) => v.toFixed(6)).join(',')}]`;
      // LEFT JOIN so listings without embeddings still surface (similarity 0)
      const result = await db.execute(sql`
        SELECT
          l.id, l.kind, l.supplier_wallet, l.submission_id, l.title, l.supplier_name, l.summary,
          l.tags, l.images, l.cover_svg, l.audio_path, l.tier, l.pricing, l.budget_cap_usdc, l.budget_spent_usdc,
          l.disclosure, l.attribution_text, l.attribution_url, l.attribution_slug, l.status, l.created_at,
          COALESCE(1 - (le.embedding <=> ${vecStr}::vector), 0) AS similarity
        FROM listings l
        LEFT JOIN listing_embeddings le ON le.listing_id = l.id
        WHERE l.status = 'active'
        ORDER BY le.embedding <=> ${vecStr}::vector NULLS LAST, l.created_at DESC
        LIMIT 200
      `);
      const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return null;
      // Facet counts describe the whole match slice — not the facet already on.
      const counts = countsFor(rows.map((r) => ({ kind: String(r.kind), tier: String(r.tier) })));
      // Map + score
      const scored = rows.map((r) => {
        const tags = (r.tags as string[]) ?? [];
        const { score: tagScore, hits } = scoreTagOverlap(tags, opts.tokens);
        const sim = typeof r.similarity === 'number' ? r.similarity : Number(r.similarity) || 0;
        const simScore = sim * 10; // 0..10
        const score = simScore * 0.7 + tagScore * 0.3;
        const why = hits.length ? explainTagHits(hits) : sim > 0.3 ? ['ethos similarity'] : [];
        return { raw: r, score, why, sim };
      });
      // Re-sort by hybrid score (semantic primary + tag secondary)
      scored.sort((a,b) => b.score - a.score);
      const facet = scored.filter(
        (s) => (!opts.kind || s.raw.kind === opts.kind) && (!opts.tier || s.raw.tier === opts.tier),
      );
      const outRows: MarketplaceRow[] = facet.map((s) => {
        const r = s.raw;
        const cap = r.budget_cap_usdc as string | null;
        const spent = (r.budget_spent_usdc as string) || '0';
        let remaining: string | null = null;
        if (cap != null) {
          try { const c = Number(cap); const sp = Number(spent); remaining = String(Math.max(0, c - sp)); } catch { remaining = null; }
        }
        return {
          id: r.id as string,
          kind: r.kind as ListingKind,
          supplier_wallet: r.supplier_wallet as string,
          submission_id: r.submission_id as string | null,
          title: r.title as string,
          supplier_name: r.supplier_name as string,
          summary: r.summary as string | null,
          tags: (r.tags as string[]) ?? [],
          images: (r.images as string[]) ?? [],
          cover_svg: r.cover_svg as string | null,
          audio_path: r.audio_path as string | null,
          tier: r.tier as ListingTier,
          pricing: r.pricing as unknown,
          budget_cap_usdc: r.budget_cap_usdc as string | null,
          budget_remaining_usdc: remaining,
          budget_spent_usdc: spent,
          disclosure: r.disclosure as unknown,
          attribution_text: r.attribution_text as string,
          attribution_url: r.attribution_url as string,
          attribution_slug: r.attribution_slug as string,
          status: r.status as string,
          created_at: (r.created_at as Date)?.toISOString?.() ?? String(r.created_at),
          fit_score: Math.round(s.score * 100) / 100,
          why_fits: s.why,
          similarity: s.sim,
        };
      });
      return finalizeMarketplace({ rows: outRows, counts, mode: 'semantic', sort: opts.sort, limit: opts.limit, offset: opts.offset });
    } catch (err) {
      log.warn('marketplace semantic search failed, falling back to tag', { error: (err as Error).message });
      return null;
    }
  }

  async function tagSearch(opts: {
    tokens: string[];
    kind: ListingKind | null | undefined;
    tier: ListingTier | null | undefined;
    sort: MarketplaceSort;
    limit: number;
    offset: number;
    channelTokens?: string[];
  }): Promise<MarketplaceSearchResult> {
    // Load the whole active slice, then apply kind/tier locally: facet
    // counts must describe the match slice, not the facet already applied.
    const candidates = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.status, 'active'))
      .limit(500);
    const counts = countsFor(candidates.map((l) => ({ kind: l.kind, tier: l.tier })));
    const facetCandidates = candidates.filter(
      (l) => (!opts.kind || l.kind === opts.kind) && (!opts.tier || l.tier === opts.tier),
    );
    const byNewestCreatedAt = (
      a: typeof listingsTable.$inferSelect,
      b: typeof listingsTable.$inferSelect,
    ) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0);
    // Further tag filter if provided via listing search tags param
    const effectiveTokens = [...opts.tokens, ...(opts.channelTokens ?? [])];
    // If no tokens, return recent
    if (effectiveTokens.length === 0) {
      const sorted = [...facetCandidates].sort(byNewestCreatedAt);
      const rows: MarketplaceRow[] = sorted.map((l) => ({
        id: l.id,
        kind: l.kind,
        supplier_wallet: l.supplierWallet,
        submission_id: l.submissionId,
        title: l.title,
        supplier_name: l.supplierName,
        summary: l.summary,
        tags: l.tags ?? [],
        images: l.images ?? [],
        cover_svg: l.coverSvg,
        audio_path: l.audioPath,
        tier: l.tier,
        pricing: l.pricing as unknown,
        budget_cap_usdc: l.budgetCapUsdc,
        budget_remaining_usdc: (() => {
          if (l.budgetCapUsdc == null) return null;
          try { const c = Number(l.budgetCapUsdc); const s = Number(l.budgetSpentUsdc); return String(Math.max(0, c - s)); } catch { return null; }
        })(),
        budget_spent_usdc: l.budgetSpentUsdc,
        disclosure: l.disclosure as unknown,
        attribution_text: l.attributionText,
        attribution_url: l.attributionUrl,
        attribution_slug: l.attributionSlug,
        status: l.status,
        created_at: l.createdAt?.toISOString?.() ?? '',
        fit_score: 0,
        why_fits: [],
        similarity: null,
      }));
      return finalizeMarketplace({ rows, counts, mode: 'recent', sort: opts.sort, limit: opts.limit, offset: opts.offset });
    }
    const scored = facetCandidates.map((l) => {
      const tags = l.tags ?? [];
      const { score, hits } = scoreTagOverlap(tags, effectiveTokens);
      return { l, score, hits };
    }).filter((s) => s.score > 0);
    scored.sort((a,b) => {
      if (b.score !== a.score) return b.score - a.score;
      const at = a.l.createdAt?.getTime?.() ?? 0;
      const bt = b.l.createdAt?.getTime?.() ?? 0;
      return bt - at;
    });
    // If no scored hits, fall back to recent (so browse never empty when tags miss)
    if (scored.length === 0) {
      const sorted = [...facetCandidates].sort(byNewestCreatedAt);
      const rows: MarketplaceRow[] = sorted.map((l) => ({
        id: l.id,
        kind: l.kind,
        supplier_wallet: l.supplierWallet,
        submission_id: l.submissionId,
        title: l.title,
        supplier_name: l.supplierName,
        summary: l.summary,
        tags: l.tags ?? [],
        images: l.images ?? [],
        cover_svg: l.coverSvg,
        audio_path: l.audioPath,
        tier: l.tier,
        pricing: l.pricing as unknown,
        budget_cap_usdc: l.budgetCapUsdc,
        budget_remaining_usdc: (() => {
          if (l.budgetCapUsdc == null) return null;
          try { const c = Number(l.budgetCapUsdc); const s = Number(l.budgetSpentUsdc); return String(Math.max(0, c - s)); } catch { return null; }
        })(),
        budget_spent_usdc: l.budgetSpentUsdc,
        disclosure: l.disclosure as unknown,
        attribution_text: l.attributionText,
        attribution_url: l.attributionUrl,
        attribution_slug: l.attributionSlug,
        status: l.status,
        created_at: l.createdAt?.toISOString?.() ?? '',
        fit_score: 0,
        why_fits: [],
        similarity: null,
      }));
      return finalizeMarketplace({ rows, counts, mode: 'recent', sort: opts.sort, limit: opts.limit, offset: opts.offset });
    }
    const rows: MarketplaceRow[] = scored.map((s) => ({
      id: s.l.id,
      kind: s.l.kind,
      supplier_wallet: s.l.supplierWallet,
      submission_id: s.l.submissionId,
      title: s.l.title,
      supplier_name: s.l.supplierName,
      summary: s.l.summary,
      tags: s.l.tags ?? [],
      images: s.l.images ?? [],
      cover_svg: s.l.coverSvg,
      audio_path: s.l.audioPath,
      tier: s.l.tier,
      pricing: s.l.pricing as unknown,
      budget_cap_usdc: s.l.budgetCapUsdc,
      budget_remaining_usdc: (() => {
        if (s.l.budgetCapUsdc == null) return null;
        try { const c = Number(s.l.budgetCapUsdc); const sp = Number(s.l.budgetSpentUsdc); return String(Math.max(0, c - sp)); } catch { return null; }
      })(),
      budget_spent_usdc: s.l.budgetSpentUsdc,
      disclosure: s.l.disclosure as unknown,
      attribution_text: s.l.attributionText,
      attribution_url: s.l.attributionUrl,
      attribution_slug: s.l.attributionSlug,
      status: s.l.status,
      created_at: s.l.createdAt?.toISOString?.() ?? '',
      fit_score: Math.round(s.score * 100) / 100,
      why_fits: explainTagHits(s.hits),
      similarity: null,
    }));
    return finalizeMarketplace({ rows, counts, mode: 'tag', sort: opts.sort, limit: opts.limit, offset: opts.offset });
  }

  return {
    async search(args: MarketplaceSearchArgs): Promise<MarketplaceSearchResult> {
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args.limit) || DEFAULT_LIMIT));
      const offset = Math.max(0, Number(args.offset) || 0);
      const sort = normalizeMarketplaceSort(args.sort);
      const key = marketplaceCacheKey({ ...args, limit, offset, sort });
      return cached(key, CACHE_TTL_MS, async () => {
        const qTokens = tokenize((args.query || '').trim());
        let channelTokens: string[] | undefined;
        let channelRow: typeof channelsTable.$inferSelect | null = null;
        if (args.channelId) {
          const [row] = await db.select().from(channelsTable).where(eq(channelsTable.id, args.channelId)).limit(1);
          if (row) { channelRow = row; channelTokens = ethosTokensForChannel(row); }
        }
        const tokens = [...qTokens, ...(channelTokens ?? [])];
        // Try semantic when we have an embedding vector for the query.
        // Query vector is either channel ethos or free text.
        if (!embedding.mock && (channelRow || qTokens.length > 0)) {
          try {
            let textForEmbed: string | null = null;
            if (channelRow) {
              textForEmbed = buildChannelEmbedText({ name: channelRow.name, niche: channelRow.niche, ethosSummary: channelRow.ethosSummary, platformDescription: channelRow.platformDescription, recentContent: channelRow.recentContent ?? [] });
              if (qTokens.length) textForEmbed = `${args.query} \n${textForEmbed}`;
            } else if (args.query) {
              textForEmbed = args.query;
            }
            if (textForEmbed) {
              const vec = await embedding.embedText(textForEmbed);
              const semantic = await semanticSearch({ queryVec: vec.embedding, kind: args.kind, tier: args.tier, sort, limit, offset, tokens });
              if (semantic && semantic.rows.length > 0) return semantic;
            }
          } catch (err) {
            log.warn('marketplace semantic setup failed', { error: (err as Error).message });
          }
        }
        return tagSearch({ tokens, kind: args.kind, tier: args.tier, sort, limit, offset, channelTokens: undefined });
      }, ['feed-update']);
    },
  };
}

export type MarketplaceService = ReturnType<typeof createMarketplaceService>;
