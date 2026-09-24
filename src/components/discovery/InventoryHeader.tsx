"use client";

// M1 (docs/interface.md): inventory before manifesto. The browse header
// states what is on the shelf — total in view, the facet-free slice
// breakdown, and how the order was chosen — before any card is read.
//
// HONESTY: `total` is the post-facet count (what the pager pages over) and
// the breakdown comes from the API's pre-facet `counts`. They are labelled
// differently on purpose: "N listings" is what you're looking at, "N in
// this slice" is the whole match set. Never derive either in the client.

import type { MarketplaceCounts, MarketplaceSort } from "@/lib/marketplace-client";

type Kind = "all" | "music" | "placement";
type Tier = "all" | "free" | "paid";

function rankedByLabel(opts: {
  mode: "semantic" | "tag" | "recent" | null;
  sort: MarketplaceSort;
  query: string;
  selectedChannelName: string | null;
}): string {
  if (opts.sort === "newest") return "newest first";
  if (opts.sort === "price_asc") return "price · free first";
  if (opts.sort === "price_desc") return "price · high first";
  if (opts.mode === "semantic") {
    if (opts.selectedChannelName)
      return `${opts.selectedChannelName} ethos${opts.query ? " + search" : ""}`;
    return "search relevance";
  }
  if (opts.mode === "tag") return "tag match";
  if (opts.mode === "recent") return "newest first";
  return "…";
}

export function InventoryHeader({
  total,
  counts,
  mode,
  sort,
  query,
  selectedChannelName,
  kind,
  tier,
  loading,
}: {
  total: number;
  counts?: MarketplaceCounts | null;
  mode: "semantic" | "tag" | "recent" | null;
  sort: MarketplaceSort;
  query: string;
  selectedChannelName: string | null;
  kind: Kind;
  tier: Tier;
  loading: boolean;
}) {
  const facets = [
    kind === "all" ? null : kind === "music" ? "Music only" : "Products only",
    tier === "all" ? null : `${tier} only`,
  ].filter((f): f is string => !!f);

  return (
    <div className="min-w-0">
      <p className="font-serif text-xl font-black tracking-tight text-[var(--color-ink)]">
        {loading ? "Searching…" : `${total} listing${total === 1 ? "" : "s"}`}
      </p>
      <p className="mt-0.5 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        {facets.length > 0 ? `${facets.join(" · ")} · ` : ""}
        {rankedByLabel({ mode, sort, query, selectedChannelName })}
      </p>
      {counts && counts.total > 0 && (
        <p className="mt-0.5 font-mono text-[12px] text-[var(--color-ink-3)]">
          {counts.total} in this slice · {counts.music} music · {counts.placement} products ·{" "}
          {counts.free} free · {counts.paid} paid
        </p>
      )}
    </div>
  );
}
