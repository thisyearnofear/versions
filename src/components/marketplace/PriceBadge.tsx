"use client";

// M2 (docs/interface.md): price is a first-class citizen. One badge shape
// everywhere a listing is summarized, so a buyer can price-scan a grid
// without reading a card. Free is deliberately the quiet tone and paid the
// accent — the free tier is the wedge, and paid is what the badge is for.

import { listingPriceBadge, type MarketplaceListing } from "@/lib/marketplace-client";
import { cn } from "@/lib/utils";

export function PriceBadge({
  listing,
  className,
}: {
  listing: Pick<MarketplaceListing, "tier" | "pricing">;
  className?: string;
}) {
  const free = listing.tier === "free";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] shadow-[var(--shadow-soft)]",
        free
          ? "border border-[var(--color-hair-strong)] bg-[var(--color-cream)] text-[var(--color-ink-2)]"
          : "bg-[var(--color-rust)] text-[var(--color-paper)]",
        className,
      )}
      title={free ? "Free to use with the required credit" : "Paid placement — bought by the channel operator"}
    >
      {listingPriceBadge(listing)}
    </span>
  );
}
