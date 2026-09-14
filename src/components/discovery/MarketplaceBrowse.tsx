"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type Listing = {
  id: string;
  kind: "music" | "placement";
  title: string;
  supplier_name: string;
  summary: string | null;
  tags: string[];
  images: string[];
  cover_svg: string | null;
  audio_path: string | null;
  tier: "free" | "paid";
  pricing: { model: "flat" | "cpm"; flatFeeUsdc?: string; cpmUsdc?: string } | null;
  budget_cap_usdc: string | null;
  budget_remaining_usdc: string | null;
  disclosure: { label: string; statement: string } | null;
  attribution_text: string;
  attribution_url: string;
  attribution_slug: string;
  status: string;
  fit_score?: number;
  why_fits?: string[];
  similarity?: number | null;
};

type ChannelLite = { id: string; name: string; can_buy_slots: boolean; verification_status: string; niche?: string | null };

export function MarketplaceBrowse() {
  const { showToast } = useToast();
  const [kind, setKind] = useState<"all" | "music" | "placement">("all");
  const [tier, setTier] = useState<"all" | "free" | "paid">("all");
  const [q, setQ] = useState("");
  const [channelId, setChannelId] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [mode, setMode] = useState<string>("recent");
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<ChannelLite[]>([]);
  const [usageSummary, setUsageSummary] = useState<{ total_events: number; spend_usdc: string; by_reporter: Record<string, number> } | null>(null);
  const [buyFor, setBuyFor] = useState<string | null>(null);
  const [buyChannelId, setBuyChannelId] = useState("");
  const [buyBudget, setBuyBudget] = useState("");
  const [buying, setBuying] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (kind !== "all") params.set("kind", kind);
      if (tier !== "all") params.set("tier", tier);
      const hasQuery = q.trim().length >= 2 || channelId;
      if (hasQuery) {
        if (q.trim()) params.set("q", q.trim());
        if (channelId) params.set("channelId", channelId);
        const res = await fetch(`/api/v1/marketplace/search?${params}`, { credentials: "same-origin" });
        const json = (await res.json()) as { success?: boolean; data?: { rows?: Listing[]; mode?: string } };
        setListings(json.data?.rows ?? []);
        setMode(json.data?.mode ?? "recent");
      } else {
        const res = await fetch(`/api/v1/listings?${params}`, { credentials: "same-origin" });
        const json = (await res.json()) as { success?: boolean; data?: { listings?: Listing[] } };
        setListings((json.data?.listings ?? []) as Listing[]);
        setMode("recent");
      }
    } catch {
      showToast("Could not load supply.", "error");
    } finally {
      setLoading(false);
    }
  }, [kind, tier, q, channelId, showToast]);

  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/channels?limit=20", { credentials: "same-origin" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { channels?: ChannelLite[] } };
      setChannels(json.data?.channels ?? []);
      if (json.data?.channels?.[0] && !buyChannelId) setBuyChannelId(json.data.channels[0].id);
    } catch {}
  }, [buyChannelId]);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/usage", { credentials: "same-origin" });
      const json = (await res.json()) as { data?: { summary?: typeof usageSummary } };
      if (json.data?.summary) setUsageSummary(json.data.summary as never);
    } catch {}
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadChannels(); void loadUsage(); }, [loadChannels, loadUsage]);

  // Debounced search on q/channel change — avoid firing on every keystroke
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { void load(); }, [debouncedQ, channelId, kind, tier]); // re-trigger via debounced

  const startBuy = useCallback((id: string) => { setBuyFor(id); track("slot_intent", { listingId: id }); }, []);

  const buy = useCallback(async (listingId: string) => {
    if (!buyChannelId) { showToast("Pick a channel to buy with.", "warning"); return; }
    setBuying(true);
    try {
      const createRes = await fetch("/api/v1/slots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, channelId: buyChannelId, budgetUsdc: buyBudget.trim() || null }), credentials: "same-origin" });
      const createJson = (await createRes.json()) as { success: boolean; error?: { message: string }; data?: { slot: { id: string } } };
      if (!createRes.ok || !createJson.success) throw new Error(createJson.error?.message ?? `HTTP ${createRes.status}`);
      const slotId = createJson.data!.slot.id;
      const payRes = await fetch(`/api/v1/slots/${slotId}/pay`, { method: "POST", credentials: "same-origin" });
      const payJson = (await payRes.json()) as { success: boolean; error?: { message: string } };
      if (!payRes.ok || !payJson.success) throw new Error(payJson.error?.message ?? `Created ${slotId.slice(0, 8)} — now pay: POST /api/v1/slots/${slotId}/pay`);
      track("slot_purchased", { listingId, channelId: buyChannelId });
      showToast("Placement active — tracking code minted. Report where it ran under Usage.", "success", 5000);
      setBuyFor(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      showToast(msg, "error");
    } finally {
      setBuying(false);
    }
  }, [buyChannelId, buyBudget, showToast]);

  const copy = useCallback(async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); showToast(`${label} copied.`, "success", 2000); } catch { showToast(text, "info", 4000); }
  }, [showToast]);

  const modeLabel = mode === "semantic" ? "ethos" : mode === "tag" ? "tag match" : "recent";

  return (
    <section className="mt-4 space-y-4" aria-label="Marketplace supply">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-[var(--color-hair)] p-1">
          {(["all", "music", "placement"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide", kind === k ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "text-[var(--color-ink-2)] hover:text-[var(--color-rust)]")}>{k}</button>
          ))}
        </div>
        <div className="flex rounded-full border border-[var(--color-hair)] p-1">
          {(["all", "free", "paid"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTier(t)} className={cn("rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide", tier === t ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "text-[var(--color-ink-2)] hover:text-[var(--color-rust)]")}>{t}</button>
          ))}
        </div>
        {channels.length > 0 && (
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="rounded-full border border-[var(--color-hair)] bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">
            <option value="">All channels</option>
            {channels.map((c) => (<option key={c.id} value={c.id}>{c.name.slice(0,28)} · {c.niche ?? c.verification_status}</option>))}
          </select>
        )}
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe the vibe — lo-fi night drive, study focus, thriller tension…" className="min-w-[220px] flex-1 rounded-full border border-[var(--color-hair)] bg-transparent px-4 py-2 font-serif text-sm placeholder:text-[var(--color-ink-3)] focus:outline-none focus:border-[var(--color-rust)]" />
        <span className="self-center font-mono text-[10px] text-[var(--color-ink-3)]">{loading ? "…" : `${listings.length} · ${modeLabel}`}</span>
      </div>
      {channelId && mode === "semantic" && <p className="font-mono text-[10px] text-[var(--color-rust)]">Personalized by channel ethos + search terms — semantic ranking.</p>}
      {channelId && mode === "tag" && <p className="font-mono text-[10px] text-[var(--color-ink-3)]">Ranked by tag overlap with your channel ethos.</p>}

      {usageSummary && usageSummary.total_events > 0 && (
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">
          Flywheel: {usageSummary.total_events} uses logged · {usageSummary.spend_usdc} USDC delivered · channel-reported {usageSummary.by_reporter.channel ?? 0} · platform {usageSummary.by_reporter.platform_api ?? 0}
        </p>
      )}

      {listings.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-hair-strong)] p-8 text-center">
          <p className="font-serif text-sm text-[var(--color-ink-2)]">{loading ? "Loading supply…" : q.trim() || channelId ? "No supply fits that vibe. Try a broader search or All channels." : "No live supply for that filter. Try All, or list something on the Supply page."}</p>
          <Link href="/submit" className="mt-3 inline-flex rounded-full border border-[var(--color-hair-strong)] px-4 py-2 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]">Go to Supply →</Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {listings.map((l) => (
            <article key={l.id} className="card-surface overflow-hidden p-0">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide", l.kind === "music" ? "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]" : "bg-[var(--color-rust-soft)] text-[var(--color-rust)]")}>{l.kind}</span>
                  <span className={cn("rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide", l.tier === "free" ? "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]" : "bg-[var(--color-ink)] text-[var(--color-paper)]")}>{l.tier === "free" ? "free · attribution" : l.pricing?.model === "flat" ? `paid · flat ${l.pricing.flatFeeUsdc} USDC` : `paid · CPM ${l.pricing?.cpmUsdc} USDC`}</span>
                </div>
                <h4 className="mt-2 font-serif text-base font-bold leading-tight">{l.title}</h4>
                <p className="font-serif text-sm text-[var(--color-ink-2)]">{l.supplier_name}</p>
                {l.summary && <p className="mt-1 line-clamp-2 font-serif text-sm leading-snug text-[var(--color-ink-2)]">{l.summary}</p>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {l.tags.slice(0, 6).map((t) => (
                    <span key={t} className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">{t}</span>
                  ))}
                </div>
                {(l.why_fits?.length || l.fit_score) ? (
                  <p className="mt-2 font-mono text-[10px] text-[var(--color-rust)]">{l.why_fits?.join(" · ")}{typeof l.fit_score === "number" && l.fit_score > 0 ? ` · score ${l.fit_score}` : ""}</p>
                ) : null}
                {l.tier === "paid" && (
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
                    {l.budget_remaining_usdc != null ? `Remaining: ${l.budget_remaining_usdc} USDC` : "Uncapped"} · {l.disclosure ? `${l.disclosure.label} disclosure included` : ""}
                  </p>
                )}
                {l.cover_svg ? <div className="mt-3 h-14 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] p-1" dangerouslySetInnerHTML={{ __html: l.cover_svg }} /> : null}
                {l.audio_path && <audio controls preload="none" src={`/api/v1/uploads/${l.audio_path.split("/").pop()}`} className="mt-3 w-full" />}
                {l.images.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {l.images.slice(0, 3).map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt="" className="h-16 w-full rounded object-cover" loading="lazy" />
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setExpanded(expanded === l.id ? null : l.id)} className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]">{expanded === l.id ? "Hide" : "Details"}</button>
                  {l.tier === "free" ? (
                    <button type="button" onClick={() => copy(l.attribution_text, "Attribution")} className="rounded-full bg-[var(--color-paper-2)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)]">Copy attribution</button>
                  ) : (
                    <button type="button" onClick={() => startBuy(l.id)} className="rounded-full bg-[var(--color-rust)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white hover:opacity-90">Buy placement</button>
                  )}
                </div>
                {expanded === l.id && (
                  <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-paper-2)] p-3">
                    <p className="break-words font-mono text-xs leading-snug text-[var(--color-ink-2)]">{l.attribution_text}</p>
                    <button type="button" onClick={() => copy(l.attribution_text, "Attribution")} className="mt-2 font-mono text-[10px] uppercase tracking-wide text-[var(--color-rust)] hover:text-[var(--color-ink)]">Copy</button>
                    <p className="mt-2 break-all font-mono text-[10px] text-[var(--color-ink-3)]">{l.attribution_url}</p>
                    {l.disclosure && <p className="mt-2 font-mono text-[10px] text-[var(--color-rust)]">{l.disclosure.label} — {l.disclosure.statement}</p>}
                  </div>
                )}
                {buyFor === l.id && (
                  <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)] p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-rust)]">Buy this placement</p>
                    <label className="mt-2 grid gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Channel</span>
                      <select value={buyChannelId} onChange={(e) => setBuyChannelId(e.target.value)} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-xs">
                        <option value="">Pick a channel…</option>
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} · {c.verification_status}{c.can_buy_slots ? " · can buy" : " · verify first"}</option>
                        ))}
                      </select>
                    </label>
                    {l.pricing?.model === "cpm" && (
                      <label className="mt-2 grid gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Budget (USDC) — required for CPM</span>
                        <input value={buyBudget} onChange={(e) => setBuyBudget(e.target.value)} inputMode="decimal" placeholder="e.g. 50" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
                      </label>
                    )}
                    {l.pricing?.model === "flat" && (
                      <label className="mt-2 grid gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Budget cap (USDC, optional)</span>
                        <input value={buyBudget} onChange={(e) => setBuyBudget(e.target.value)} inputMode="decimal" placeholder="uncapped" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
                      </label>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void buy(l.id)} disabled={buying} className="btn-primary disabled:opacity-50">{buying ? "Buying…" : "Pay & activate"}</button>
                      <button type="button" onClick={() => setBuyFor(null)} className="rounded-full border border-[var(--color-hair)] px-4 py-2 font-mono text-[10px] uppercase tracking-wide">Cancel</button>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-[var(--color-ink-3)]">Self-serve on Arc. 60/30/10 supplier/channel/platform. Minted tracking code + disclosure baked in. Budget cap enforced atomically.</p>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
