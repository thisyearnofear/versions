"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";

export function UsageReporter({ defaultListingId, defaultChannelId }: { defaultListingId?: string; defaultChannelId?: string }) {
  const { showToast } = useToast();
  const [listingId, setListingId] = useState(defaultListingId ?? "");
  const [channelId, setChannelId] = useState(defaultChannelId ?? "");
  const [videoUrl, setVideoUrl] = useState("");
  const [impressions, setImpressions] = useState("1200");
  const [clicks, setClicks] = useState("0");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ spend_usdc: string; kind: string } | null>(null);

  const submit = useCallback(async () => {
    if (!listingId.trim() || !channelId.trim()) { showToast("Pick a listing and a channel.", "warning"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          listingId: listingId.trim(),
          channelId: channelId.trim(),
          videoUrl: videoUrl.trim() || null,
          impressions: Number(impressions) || 0,
          clicks: Number(clicks) || 0,
        }),
      });
      const json = (await res.json()) as { success: boolean; error?: { code?: string; message: string }; data?: { usage: { spend_usdc: string; kind: string; reported_by: string } } };
      if (!res.ok || !json.success) {
        const code = json.error?.code ?? "";
        const hint = code === "BUDGET_EXHAUSTED" ? " — this placement hit its cap and stopped serving." : code === "SLOT_NOT_ACTIVE" ? " — that slot isn't active (paused/exhausted)." : "";
        throw new Error((json.error?.message ?? `HTTP ${res.status}`) + hint);
      }
      setLast({ spend_usdc: json.data!.usage.spend_usdc, kind: json.data!.usage.kind });
      showToast(json.data!.usage.spend_usdc !== "0" ? `Logged · ${json.data!.usage.spend_usdc} USDC moved against the cap.` : "Logged · free use, no spend — attribution recorded.", "success", 4000);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [listingId, channelId, videoUrl, impressions, clicks, showToast]);

  return (
    <section className="card-surface p-5" aria-label="Report where it ran">
      <p className="kicker">Report where it ran</p>
      <h3 className="mt-1 font-serif text-base font-bold">Every use, logged — the flywheel.</h3>
      <p className="mt-1 font-serif text-sm leading-snug text-[var(--color-ink-2)]">
        Which channel used which listing, when, where. Sponsored delivery moves spend against the cap atomically; you cannot report spend directly — only impressions.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Listing ID</span>
          <input value={listingId} onChange={(e) => setListingId(e.target.value)} placeholder="list_…" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-xs" />
        </label>
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Channel ID</span>
          <input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="chan_…" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-xs" />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Video URL (where it ran, if any)</span>
          <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-xs" />
        </label>
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Impressions</span>
          <input value={impressions} onChange={(e) => setImpressions(e.target.value)} inputMode="numeric" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
        </label>
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Clicks</span>
          <input value={clicks} onChange={(e) => setClicks(e.target.value)} inputMode="numeric" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
        </label>
      </div>
      <button type="button" onClick={submit} disabled={busy} className="btn-primary mt-4 disabled:opacity-50">{busy ? "Logging…" : "Log usage"}</button>
      {last && (
        <p className="mt-3 rounded-full bg-[var(--color-paper-2)] px-3 py-2 font-mono text-xs text-[var(--color-ink-2)]">
          Last: {last.kind} · spend {last.spend_usdc} USDC {last.spend_usdc === "0" ? "(free)" : "(capped)"}
        </p>
      )}
      <p className="kicker mt-3">Spend is written only from what the slot actually moved against its cap. Caps are enforced by a guarded atomic UPDATE — concurrent events can never double-spend.</p>
    </section>
  );
}
