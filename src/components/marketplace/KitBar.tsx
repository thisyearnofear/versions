"use client";

// The kit bar — rung 3 of the onboarding ladder (docs/interface.md §4.4).
// It is the reason a browse session ends with the visitor holding
// something: the shortlist, the exact credit lines, and the media links.
//
// CLAIM DISCIPLINE: copying a credit is not a use and nothing here says
// otherwise. Paid listings appear as a shortlist with a reserve link and
// carry NO credit — the #ad attribution is issued to the channel when the
// slot is bought. The bar also never claims cloud sync: it says "this
// browser" because that is all localStorage is.

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  clearKit,
  isKitPersisted,
  kitCreditsText,
  kitExportText,
  kitFreeItems,
  kitListingHref,
  kitPaidItems,
  removeKitItem,
  type KitItem,
} from "@/lib/kit";
import { useKit } from "@/lib/use-kit";
import { useToast } from "@/components/ui/Toast";
import { track } from "@/lib/analytics";

function downloadKit(items: KitItem[]): boolean {
  try {
    const text = kitExportText(items, { siteOrigin: window.location.origin });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "versions-kit.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Presentational half — no browser APIs, so it is unit-testable. */
export function KitBarView({ items, persisted = true }: { items: KitItem[]; persisted?: boolean }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const free = kitFreeItems(items);
  const paid = kitPaidItems(items);

  const onCopy = useCallback(async () => {
    if (free.length === 0) {
      showToast(
        "Nothing to copy yet — a paid placement is a shortlist until you reserve it.",
        "info",
        4000,
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(kitCreditsText(items));
      track("kit_copy", { count: free.length, paid: paid.length });
      showToast(
        `Copied ${free.length} credit line${free.length === 1 ? "" : "s"}${
          paid.length > 0
            ? ` · ${paid.length} paid placement${paid.length === 1 ? "" : "s"} excluded until reserved`
            : ""
        }.`,
        "success",
        4000,
      );
    } catch {
      showToast("Copy failed — open the kit and select the credit text manually.", "warning", 5000);
    }
  }, [items, free.length, paid.length, showToast]);

  const onExport = useCallback(() => {
    const ok = downloadKit(items);
    track("kit_export", { count: items.length, free: free.length, paid: paid.length });
    showToast(
      ok
        ? `Saved versions-kit.txt — ${free.length} ready to publish, ${paid.length} to reserve.`
        : "Could not save the file — use Copy credits instead.",
      ok ? "success" : "warning",
      4000,
    );
  }, [items, free.length, paid.length, showToast]);

  const onClear = useCallback(() => {
    clearKit();
    setOpen(false);
    track("kit_clear", {});
    showToast("Kit cleared.", "info", 2500);
  }, [showToast]);

  const onRemove = useCallback((item: KitItem) => {
    removeKitItem(item.listingId);
    track("kit_remove", { listingId: item.listingId, tier: item.tier });
  }, []);

  if (items.length === 0) return null;

  return (
    <section
      aria-label="Your kit"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-hair-strong)] bg-[var(--color-cream)]/95 backdrop-blur-md"
    >
      <div className="mx-auto max-w-5xl px-4 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
            <span className="text-[var(--color-ink)]">{items.length} saved</span>
            {" · "}
            {free.length} ready to publish
            {paid.length > 0 ? ` · ${paid.length} to reserve` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void onCopy()} className="btn-secondary">
              Copy credits
            </button>
            <button type="button" onClick={onExport} className="btn-secondary">
              Export .txt
            </button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--color-hair-strong)] px-4 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
            >
              {open ? "Hide list" : "View list"}
            </button>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-[44px] items-center px-2 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
            >
              Clear
            </button>
          </div>
        </div>

        <p className="mt-1 font-mono text-[11px] leading-snug text-[var(--color-ink-3)]">
          Copying a credit does not log a use — report where it ran from the listing page.{" "}
          {persisted
            ? "Saved in this browser."
            : "Saved for this visit only (storage unavailable)."}
        </p>

        {open && (
          <ul className="mt-2 grid max-h-[45vh] gap-2 overflow-y-auto border-t border-[var(--color-hair)] pt-2">
            {items.map((item) => (
              <li
                key={item.listingId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={kitListingHref(item)}
                    className="font-serif text-[15px] font-semibold text-[var(--color-ink)] hover:text-[var(--color-rust)]"
                  >
                    {item.title}
                  </Link>
                  <p className="font-serif text-[13px] text-[var(--color-ink-2)]">
                    {item.supplierName}
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                      {item.kind === "music" ? "Music" : "Product"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={
                      item.tier === "free"
                        ? "font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)]"
                        : "font-mono text-[12px] uppercase tracking-wide text-[var(--color-rust)]"
                    }
                  >
                    {item.priceLabel}
                  </span>
                  {item.tier === "paid" ? (
                    <Link
                      href={kitListingHref(item)}
                      className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-rust)] underline"
                    >
                      Reserve →
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemove(item)}
                    aria-label={`Remove ${item.title} from your kit`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-mono text-[12px] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Connected half — subscribes to the store for the presentational bar. */
export function KitBar() {
  const items = useKit();
  return <KitBarView items={items} persisted={isKitPersisted()} />;
}
