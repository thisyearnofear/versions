"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MarketplaceError,
  createRequestScope,
  listingPriceLabel,
  marketplaceRequest,
  searchHref,
  updateBrowseHref,
  type ChannelRecord,
  type MarketplaceListing,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type Kind = "all" | "music" | "placement";
type Tier = "all" | "free" | "paid";

const PAGE = 20;

interface SearchResult {
  total: number;
  mode: "semantic" | "tag" | "recent";
  rows: MarketplaceListing[];
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
  const kind: Kind = kindRaw === "music" || kindRaw === "placement" ? kindRaw : "all";
  const tier: Tier = tierRaw === "free" || tierRaw === "paid" ? tierRaw : "all";
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
          },
          offset,
        ),
        { signal },
      )
        .then((data) => {
          if (!isCurrent()) return;
          setResult(data);
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
  }, [routeQ, channelId, kind, tier, offset, tick, searchScope]);

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

  const modeLabel =
    result?.mode === "semantic"
      ? channelId
        ? "ranked by channel and search"
        : "ranked by search"
      : result?.mode === "tag"
        ? "tag match"
        : "recent";
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
      {!isAuthenticated && !channelId && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2">
          <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
            Browsing the public catalog — sign in to rank supply against your channel.
          </p>
          <WagmiConnectButton variant="quiet" />
        </div>
      )}

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
      </div>

      {selectedChannel && (
        <p className="font-mono text-[12px] text-[var(--color-ink-3)]">
          Channel context: {selectedChannel.name}
          {selectedChannel.verification_status !== "verified" ? " (pending verification)" : ""}
        </p>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)]">
          {loading && !result ? "Searching…" : result ? `${total} result${total === 1 ? "" : "s"} · ${modeLabel}` : ""}
        </p>
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
              <div className="p-3 pb-0">
                <ListingMedia
                  title={l.title}
                  kind={l.kind}
                  audioPath={l.audio_path}
                  images={l.images}
                  coverSvg={l.cover_svg}
                  compact
                />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                    {l.kind === "music" ? "Music" : "Product"} · {l.tier}
                  </span>
                </div>
                <h4 className="mt-2 font-serif text-base font-bold leading-tight">
                  <Link
                    href={listingHref(l, channelId)}
                    className="hover:text-[var(--color-rust)]"
                    onClick={() => track("nav_click", { listingId: l.id })}
                  >
                    {l.title}
                  </Link>
                </h4>
                <p className="font-serif text-[14px] text-[var(--color-ink-2)]">{l.supplier_name}</p>
                <p className="mt-1 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)]">
                  {listingPriceLabel(l)}
                </p>
                {l.summary && (
                  <p className="mt-1 line-clamp-2 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
                    {l.summary}
                  </p>
                )}
                {l.why_fits && l.why_fits.length > 0 ? (
                  <p className="mt-2 font-serif text-[13px] text-[var(--color-rust)]">
                    Fits: {l.why_fits.join(" · ").replace(/^tag: /g, "")}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {l.tags.slice(0, 6).map((t) => (
                      <span key={t} className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-ink-2)]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {l.tier === "paid" && (
                  <p className="mt-2 font-mono text-[12px] text-[var(--color-ink-3)]">
                    {l.budget_remaining_usdc != null
                      ? `Campaign remaining: ${l.budget_remaining_usdc} USDC`
                      : "Uncapped campaign"}
                  </p>
                )}
                <div className="mt-3">
                  <Link
                    href={listingHref(l, channelId)}
                    className="btn-primary inline-flex"
                    onClick={() => track("slot_intent", { listingId: l.id, tier: l.tier })}
                  >
                    {l.tier === "free" ? "Use this listing" : "Review placement"}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
