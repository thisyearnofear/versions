"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MarketplaceError,
  createRequestScope,
  isMarketplaceSort,
  marketplaceRequest,
  searchHref,
  updateBrowseHref,
  type ChannelRecord,
  type MarketplaceCounts,
  type MarketplaceListing,
  type MarketplaceSort,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { PriceBadge } from "@/components/marketplace/PriceBadge";
import { FitNote } from "@/components/marketplace/FitNote";
import { AddToKitButton } from "@/components/marketplace/AddToKitButton";
import { ChannelProbe } from "@/components/discovery/ChannelProbe";
import { InventoryHeader } from "@/components/discovery/InventoryHeader";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type Kind = "all" | "music" | "placement";
type Tier = "all" | "free" | "paid";

const PAGE = 20;

interface SearchResult {
  total: number;
  mode: "semantic" | "tag" | "recent";
  rows: MarketplaceListing[];
  counts?: MarketplaceCounts;
  sort?: MarketplaceSort;
  degraded?: boolean;
}

function listingHref(listing: MarketplaceListing, channelId: string): string {
  const p = new URLSearchParams();
  if (channelId) p.set("channelId", channelId);
  const suffix = p.size ? `?${p}` : "";
  return `/listings/${listing.id}${suffix}`;
}

// MODULAR: seeded from ?q= so the landing hero search deep-links straight
// into ranked marketplace supply. Threshold (≥2) matches the API's
// tag/semantic switch — shorter strings stay on recency.
export function MarketplaceBrowse() {
  const { walletAddress, isAuthenticated } = useSupervisorAuth();
  return (
    <MarketplaceBrowseContent key={walletAddress ?? "guest"} isAuthenticated={isAuthenticated} />
  );
}

function MarketplaceBrowseContent({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const params = useSearchParams();

  const routeQ = params.get("q") ?? "";
  const channelId = params.get("channelId") ?? "";
  const kindRaw = params.get("kind");
  const tierRaw = params.get("tier");
  const sortRaw = params.get("sort");
  const kind: Kind = kindRaw === "music" || kindRaw === "placement" ? kindRaw : "all";
  const tier: Tier = tierRaw === "free" || tierRaw === "paid" ? tierRaw : "all";
  const sort: MarketplaceSort = isMarketplaceSort(sortRaw) ? sortRaw : "fit";
  const offsetParam = Number(params.get("offset") ?? "0");
  const offset = Number.isSafeInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  const [draft, setDraft] = useState({ source: routeQ, text: routeQ });
  const q = draft.source === routeQ ? draft.text : routeQ;

  const [channels, setChannels] = useState<ChannelRecord[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [channelTick, setChannelTick] = useState(0);
  const [searchScope] = useState(() => createRequestScope());
  const [channelScope] = useState(() => createRequestScope());

  const applyPatch = useCallback(
    (patch: Record<string, string | null>) => {
      router.replace(updateBrowseHref(params.toString(), patch), { scroll: false });
    },
    [params, router],
  );

  // Debounced search on q/channel change — avoid firing on every keystroke
  useEffect(() => {
    if (q === routeQ) return;
    const t = window.setTimeout(() => {
      if (q.trim() === routeQ) return;
      applyPatch({ q: q.trim() || null, offset: null });
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, routeQ, applyPatch]);

  useEffect(() => {
    const { signal, isCurrent } = searchScope.start();
    const t = window.setTimeout(() => {
      if (!isCurrent()) return;
      setLoading(true);
      setError(null);
      marketplaceRequest<SearchResult>(
        searchHref(
          {
            q: routeQ,
            channelId,
            kind: kind === "all" ? undefined : kind,
            tier: tier === "all" ? undefined : tier,
            sort: sort === "fit" ? undefined : sort,
          },
          offset,
        ),
        { signal },
      )
        .then((data) => {
          if (!isCurrent()) return;
          setResult(data);
          // Degraded empty results carry raw-SQL-free honesty downstream —
          // surface a plain note instead of the raw error panel.
          setError(data.degraded ? "The catalog is briefly unreachable — showing no matches for now." : null);
          setLoading(false);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          setError(
            err instanceof MarketplaceError
              ? err.message
              : "Could not load supply. Check your connection and retry.",
          );
          setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(t);
      searchScope.cancel();
    };
  }, [routeQ, channelId, kind, tier, sort, offset, tick, searchScope]);

  useEffect(() => {
    const { signal, isCurrent } = channelScope.start();
    const t = window.setTimeout(() => {
      if (!isCurrent()) return;
      if (!isAuthenticated) {
        setChannels([]);
        return;
      }
      setChannelsError(null);
      marketplaceRequest<{ channels: ChannelRecord[] }>("/api/v1/channels?limit=100", { signal })
        .then((data) => {
          if (isCurrent()) setChannels(data.channels ?? []);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          setChannelsError(
            err instanceof Error ? err.message : "Could not load your channels.",
          );
        });
    }, 0);
    return () => {
      window.clearTimeout(t);
      channelScope.cancel();
    };
  }, [isAuthenticated, channelTick, channelScope]);

  const total = result?.total ?? 0;
  const listings = result?.rows ?? [];
  const hasMore = offset + PAGE < total;
  const selectedChannel = (channels ?? []).find((c) => c.id === channelId) ?? null;

  return (
    <section className="mt-4 space-y-4" aria-label="Marketplace supply" aria-busy={loading}>
      {isAuthenticated && channelsError && (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-rust)] p-3">
          <p className="font-serif text-[14px] text-[var(--color-rust)]">{channelsError}</p>
          <button
            type="button"
            onClick={() => setChannelTick((t) => t + 1)}
            className="btn-secondary mt-2"
          >
            Retry
          </button>
        </div>
      )}
      {isAuthenticated && channels !== null && !channelsError && (
        channels.length > 0 ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2">
            <label className="flex flex-wrap items-center gap-2">
              <span className="marketplace-label shrink-0">Channel context</span>
              <select
                value={channelId}
                onChange={(e) => applyPatch({ channelId: e.target.value || null, offset: null })}
                className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px]"
              >
                <option value="">Any channel — browse the whole catalog</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.verification_status !== "verified" ? " (pending)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2">
            <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
              Connect a channel to rank supply against its ethos.{" "}
              <Link href="/channels" className="text-[var(--color-rust)] underline">
                Connect a channel →
              </Link>
            </p>
          </div>
        )
      )}
      {channelId && !selectedChannel && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2">
          <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
            Linked channel context — ranking by the channel that shared this link.
          </p>
          <button
            type="button"
            onClick={() => applyPatch({ channelId: null })}
            className="min-h-[44px] rounded-full border border-[var(--color-hair-strong)] px-4 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
          >
            Remove ×
          </button>
        </div>
      )}
      {!isAuthenticated && <ChannelProbe />}

      <div className="flex flex-wrap items-stretch gap-2">
        <input
          value={q}
          onChange={(e) => setDraft({ source: routeQ, text: e.target.value })}
          placeholder="Search the vibe you publish…"
          aria-label="Search listings"
          className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-4 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]"
        />
        <div className="flex rounded-full border border-[var(--color-hair)] p-1" role="group" aria-label="Listing kind">
          {(["all", "music", "placement"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => applyPatch({ kind: k === "all" ? null : k, offset: null })}
              className={cn(
                "min-h-[44px] rounded-full px-4 font-mono text-[12px] uppercase tracking-wide",
                kind === k
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                  : "text-[var(--color-ink-2)] hover:text-[var(--color-rust)]",
              )}
            >
              {k === "all" ? "All" : k === "music" ? "Music" : "Products"}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-[var(--color-hair)] p-1" role="group" aria-label="Tier">
          {(["all", "free", "paid"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tier === t}
              onClick={() => applyPatch({ tier: t === "all" ? null : t, offset: null })}
              className={cn(
                "min-h-[44px] rounded-full px-4 font-mono text-[12px] uppercase tracking-wide",
                tier === t
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                  : "text-[var(--color-ink-2)] hover:text-[var(--color-rust)]",
              )}
            >
              {t === "all" ? "All tiers" : t}
            </button>
          ))}
        </div>
        <label className="flex min-h-[52px] items-center gap-2 rounded-full border border-[var(--color-hair)] px-3">
          <span className="marketplace-label shrink-0">Sort</span>
          <select
            value={sort}
            onChange={(e) =>
              applyPatch({ sort: e.target.value === "fit" ? null : e.target.value, offset: null })
            }
            aria-label="Sort listings"
            className="min-h-[44px] bg-transparent font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)] focus:outline-none"
          >
            <option value="fit">Best fit</option>
            <option value="newest">Newest</option>
            <option value="price_asc">Price · free first</option>
            <option value="price_desc">Price · high first</option>
          </select>
        </label>
      </div>

      {selectedChannel && (
        <p className="font-mono text-[12px] text-[var(--color-ink-3)]">
          Channel context: {selectedChannel.name}
          {selectedChannel.verification_status !== "verified" ? " (pending verification)" : ""}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <InventoryHeader
          total={total}
          counts={result?.counts}
          mode={result?.mode ?? null}
          sort={sort}
          query={routeQ}
          selectedChannelName={selectedChannel?.name ?? null}
          kind={kind}
          tier={tier}
          loading={loading && !result}
        />
        {(offset > 0 || hasMore) && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || offset === 0}
              onClick={() => applyPatch({ offset: String(Math.max(0, offset - PAGE)) })}
              className="btn-secondary disabled:opacity-50"
            >
              ← Newer
            </button>
            <button
              type="button"
              disabled={loading || !hasMore}
              onClick={() => applyPatch({ offset: String(offset + PAGE) })}
              className="btn-secondary disabled:opacity-50"
            >
              More →
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-rust)] p-4">
          <p className="font-serif text-[15px] text-[var(--color-rust)]">{error}</p>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="btn-secondary mt-2"
          >
            Retry
          </button>
        </div>
      ) : listings.length === 0 && !loading ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-hair)] p-4">
          <p className="font-serif text-[15px] text-[var(--color-ink-2)]">
            No listings match{routeQ ? ` “${routeQ}”` : ""} yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyPatch({ q: null, kind: null, tier: null, offset: null })}
              className="btn-secondary"
            >
              Clear filters
            </button>
            <Link href="/submit" className="btn-secondary">
              List supply →
            </Link>
          </div>
        </div>
      ) : (
        <div className={cn("marketplace-grid", loading && "opacity-70")}>
          {listings.map((l) => (
            <article key={l.id} className="card-surface overflow-hidden">
              <div className="relative p-3 pb-0">
                <ListingMedia
                  title={l.title}
                  kind={l.kind}
                  audioPath={l.audio_path}
                  images={l.images}
                  coverSvg={l.cover_svg}
                  compact
                />
                {/* M2: price sits in the first two visual fields of the card. */}
                <div className="pointer-events-none absolute right-5 top-5">
                  <PriceBadge listing={l} />
                </div>
              </div>
              <div className="flex flex-col p-4">
                <h4 className="font-serif text-base font-bold leading-tight">
                  <Link
                    href={listingHref(l, channelId)}
                    className="hover:text-[var(--color-rust)]"
                    onClick={() => track("nav_click", { listingId: l.id })}
                  >
                    {l.title}
                  </Link>
                </h4>
                <p className="mt-0.5 font-serif text-[14px] text-[var(--color-ink-2)]">
                  {l.supplier_name}
                  <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                    {l.kind === "music" ? "Music" : "Product"}
                  </span>
                </p>
                {l.summary && (
                  <p className="mt-1 line-clamp-2 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
                    {l.summary}
                  </p>
                )}
                <FitNote whyFits={l.why_fits} tags={l.tags} fitScore={l.fit_score} className="mt-2" />
                {l.tier === "paid" && (
                  <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-3)]">
                    {l.budget_remaining_usdc != null
                      ? `Campaign remaining: ${l.budget_remaining_usdc} USDC`
                      : "Uncapped campaign"}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={listingHref(l, channelId)}
                    className="btn-primary inline-flex"
                    onClick={() =>
                      track("slot_intent", {
                        listingId: l.id,
                        tier: l.tier,
                        action: l.tier === "free" ? "use" : "buy",
                      })
                    }
                  >
                    {l.tier === "free" ? "Use free" : "Buy this placement"}
                  </Link>
                  <AddToKitButton listing={l} channelId={channelId || null} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
