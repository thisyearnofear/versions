"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  MarketplaceError,
  parseUsageCount,
  publishedUrl,
  reportPlacementUsage,
} from "@/lib/marketplace-client";
import { useToast } from "@/components/ui/Toast";

export function UsageReporter({
  defaultListingId,
  defaultChannelId,
  slotId,
  listingTitle,
  channelName,
  onReported,
}: {
  defaultListingId?: string;
  defaultChannelId?: string;
  slotId?: string;
  listingTitle?: string;
  channelName?: string;
  onReported?: () => void;
}) {
  const { showToast } = useToast();
  const listingId = defaultListingId ?? "";
  const channelId = defaultChannelId ?? "";
  const [videoUrl, setVideoUrl] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ kind: string; spend_usdc: string } | null>(null);

  const submit = useCallback(async () => {
    const imps = parseUsageCount(impressions);
    const clks = parseUsageCount(clicks);
    if (imps === null || clks === null) {
      setError("Impressions and clicks must be whole numbers between 0 and 100,000,000.");
      return;
    }
    const url = publishedUrl(videoUrl);
    if (!url) {
      setError("Add the published HTTPS URL where it ran.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const usage = await reportPlacementUsage({
        listingId,
        channelId,
        slotId: slotId ?? null,
        videoUrl: url,
        impressions: imps,
        clicks: clks,
      });
      setConfirmed({ kind: usage.kind, spend_usdc: usage.spend_usdc });
      setVideoUrl("");
      setImpressions("");
      setClicks("");
      showToast(
        usage.kind === "sponsored"
          ? `Logged — ${usage.spend_usdc} USDC moved against the cap.`
          : "Logged — free use recorded, no spend.",
        "success",
        4000,
      );
      onReported?.();
    } catch (e) {
      const ambiguous =
        !(e instanceof MarketplaceError) ||
        e.code === "RESPONSE_UNCONFIRMED" ||
        e.status >= 500;
      setError(
        ambiguous
          ? "Could not log this report. Refresh the delivery history before retrying — it may have been recorded."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }, [impressions, clicks, videoUrl, listingId, channelId, slotId, showToast, onReported]);

  if (!listingId || !channelId) {
    return (
      <section className="marketplace-kit" aria-label="Report where it ran">
        <h3 className="marketplace-heading">Report where it ran</h3>
        <p className="mt-2 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
          <Link href="/channels" className="text-[var(--color-rust)] underline">
            Choose a placement from Channels
          </Link>{" "}
          to report where it ran.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Report where it ran" className="grid gap-3">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        {listingTitle ?? "This listing"}
        {channelName ? ` on ${channelName}` : ""} — channel-reported delivery · not platform-verified
      </p>
      <label className="grid gap-1">
        <span className="marketplace-label">Published URL (https)</span>
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          inputMode="url"
          className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="marketplace-label">New impressions (this report)</span>
          <input
            value={impressions}
            onChange={(e) => setImpressions(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]"
          />
        </label>
        <label className="grid gap-1">
          <span className="marketplace-label">New clicks (this report)</span>
          <input
            value={clicks}
            onChange={(e) => setClicks(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]"
          />
        </label>
      </div>
      <p className="font-mono text-[12px] leading-snug text-[var(--color-ink-3)]">
        Each report adds to the total — we cannot de-duplicate automatically, so report new delivery only.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? "Logging…" : "Log this use"}
        </button>
        {error && (
          <p role="alert" className="font-serif text-[14px] text-[var(--color-rust)]">
            {error}
          </p>
        )}
      </div>
      {confirmed && (
        <p aria-live="polite" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] px-3 py-2 font-mono text-[12px] text-[var(--color-ink-2)]">
          Logged — {confirmed.kind === "sponsored" ? `${confirmed.spend_usdc} USDC moved against the cap` : "free use, no spend"}.
          Reports are cumulative; refresh the history before reporting again.
        </p>
      )}
    </section>
  );
}
