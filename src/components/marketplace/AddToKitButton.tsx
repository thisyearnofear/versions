"use client";

// Secondary-weight toggle (docs/interface.md §4.1 M4 — a card's primary CTA
// is the use/buy action, so the kit toggle never competes with it).
// No account, no network: the item is snapshotted locally at capture time.

import { useCallback } from "react";
import {
  addKitItem,
  kitItemFromListing,
  removeKitItem,
  type KitItem,
} from "@/lib/kit";
import { useKit } from "@/lib/use-kit";
import { useToast } from "@/components/ui/Toast";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export function AddToKitButton({
  listing,
  channelId = null,
  className,
}: {
  listing: Parameters<typeof kitItemFromListing>[0];
  channelId?: string | null;
  className?: string;
}) {
  const items: KitItem[] = useKit();
  const { showToast } = useToast();
  const inKit = items.some((item) => item.listingId === listing.id);

  const toggle = useCallback(() => {
    if (inKit) {
      removeKitItem(listing.id);
      track("kit_remove", { listingId: listing.id, tier: listing.tier });
      showToast("Removed from your kit.", "info", 2000);
      return;
    }
    addKitItem(kitItemFromListing(listing, channelId));
    track("kit_add", { listingId: listing.id, tier: listing.tier });
    showToast(
      listing.tier === "free"
        ? "Saved to your kit — the credit line is included."
        : "Saved to your kit — reserve it when you're ready to buy.",
      "success",
      3000,
    );
  }, [inKit, listing, channelId, showToast]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={inKit}
      title={inKit ? "Remove from your kit" : "Save to your kit — no account needed"}
      className={cn(
        "inline-flex min-h-[44px] items-center rounded-full border px-4 font-mono text-[12px] uppercase tracking-wide transition-colors",
        inKit
          ? "border-[var(--color-ink)] text-[var(--color-ink)]"
          : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
        className,
      )}
    >
      {inKit ? "In kit ✓" : "Add to kit"}
    </button>
  );
}
