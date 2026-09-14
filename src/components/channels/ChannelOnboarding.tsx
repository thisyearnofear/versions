"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { agreementFor, AGREEMENT_VERSION } from "@/lib/agreement";
import { track } from "@/lib/analytics";

type Channel = {
  id: string;
  name: string;
  platform: string;
  platform_url: string;
  platform_channel_id: string | null;
  verification_status: "pending" | "verified" | "failed";
  verification_error: string | null;
  stats: { subscriber_count: number | null; view_count: number | null; video_count: number | null; source: string | null; verified_at: string | null };
  niche: string | null;
  ethos_summary: string | null;
  recent_content: string[];
  can_buy_slots: boolean;
  status: string;
};

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function ChannelOnboarding() {
  const { showToast } = useToast();
  const [url, setUrl] = useState("");
  const [niche, setNiche] = useState("");
  const [ethos, setEthos] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const agreement = useMemo(() => agreementFor("channel"), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/channels?limit=12", { credentials: "same-origin" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { channels?: Channel[] } };
      setChannels(json.data?.channels ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const register = useCallback(async () => {
    if (!agree) { showToast("Accept the blanket agreement first.", "warning"); return; }
    if (!url.trim()) { showToast("Paste a YouTube channel URL, @handle, or UC… id.", "warning"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformUrl: url.trim(), niche: niche.trim() || null, ethosSummary: ethos.trim() || null, agreementVersion: AGREEMENT_VERSION }),
        credentials: "same-origin",
      });
      const json = (await res.json()) as { success: boolean; error?: { message: string }; data?: { channel: Channel; alreadyRegistered?: boolean } };
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      track("channel_registered", { verified: json.data!.channel.verification_status === "verified" });
      showToast(json.data!.alreadyRegistered ? "That surface is already registered." : `Channel connected — ${json.data!.channel.verification_status}.`, json.data!.channel.verification_status === "verified" ? "success" : "info");
      await load();
      if (!json.data!.alreadyRegistered) { setUrl(""); }
    } catch (e) {
      showToast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }, [agree, url, niche, ethos, showToast, load]);

  const verify = useCallback(async (id: string) => {
    setVerifying(id);
    try {
      const res = await fetch(`/api/v1/channels/${id}/verify`, { method: "POST", credentials: "same-origin" });
      const json = (await res.json()) as { success: boolean; error?: { message: string }; data?: { channel: Channel } };
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      showToast(json.data!.channel.verification_status === "verified" ? "Verified — paid placements unlocked." : `Still ${json.data!.channel.verification_status}.`, json.data!.channel.verification_status === "verified" ? "success" : "info");
      await load();
    } catch (e) {
      showToast(errMsg(e), "error");
    } finally {
      setVerifying(null);
    }
  }, [showToast, load]);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Channels">
      <p className="kicker">Channels</p>
      <h3 className="mt-1 font-serif text-xl font-black tracking-tight">Connect where you publish.</h3>
      <p className="mt-1 max-w-xl font-serif text-sm leading-snug text-[var(--color-ink-2)]">
        Paste a YouTube channel URL, handle, or ID. We pull subs and views from the platform — self-reported reach is never accepted.
        Verification gates paid placements. Niche and ethos tune your browse.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">YouTube channel (URL / @handle / UC…)</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/@yourchannel or https://www.youtube.com/channel/UC…" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Niche (for matching)</span>
            <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. lo-fi study streams" maxLength={120} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
          </label>
          <label className="grid gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Ethos in your own words</span>
            <input value={ethos} onChange={(e) => setEthos(e.target.value)} placeholder="e.g. calm, analog, late-night" maxLength={1000} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
          </label>
        </div>

        <details>
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">Agreement ({AGREEMENT_VERSION})</summary>
          <div className="mt-3 space-y-2">
            {agreement.terms.map((t) => (
              <p key={t.slice(0, 40)} className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">• {t}</p>
            ))}
            <p className="font-serif text-sm font-semibold italic text-[var(--color-ink)]">“{agreement.acceptance}”</p>
          </div>
        </details>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
          <span className="font-mono text-xs leading-snug text-[var(--color-ink-2)]">{agreement.acceptance}</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={register} disabled={busy || !agree} className="btn-primary disabled:opacity-50">
            {busy ? "Connecting…" : "Connect channel"}
          </button>
          <span className="font-mono text-[10px] text-[var(--color-ink-3)]">Without an API key this lands as pending with mock numbers — real verification needs YOUTUBE_API_KEY.</span>
        </div>
      </div>

      {channels.length > 0 && (
        <div className="mt-6 grid gap-3">
          <p className="kicker">Your channels</p>
          {channels.map((c) => (
            <div key={c.id} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-serif text-sm font-semibold">{c.name}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${c.verification_status === "verified" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : c.verification_status === "pending" ? "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]" : "bg-[var(--color-rust)] text-white"}`}>{c.verification_status}{c.can_buy_slots ? " · can buy" : ""}</span>
              </div>
              <p className="mt-1 break-all font-mono text-[11px] text-[var(--color-ink-3)]">{c.platform_url}</p>
              <p className="mt-1 font-mono text-[11px] text-[var(--color-ink-2)]">
                {c.stats.subscriber_count != null ? `${c.stats.subscriber_count.toLocaleString()} subs` : "—"} · {c.stats.view_count != null ? `${c.stats.view_count.toLocaleString()} views` : "—"} · {c.stats.video_count ?? "—"} videos · <span className="text-[var(--color-ink-3)]">{c.stats.source ?? "—"}</span>
                {c.niche ? ` · niche: ${c.niche}` : ""}
              </p>
              {c.verification_error && <p className="mt-1 font-mono text-[10px] text-[var(--color-rust)]">{c.verification_error}</p>}
              {c.recent_content.length > 0 && (
                <p className="mt-2 font-mono text-[10px] leading-snug text-[var(--color-ink-3)]">Recent: {c.recent_content.slice(0, 3).join(" · ")}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void verify(c.id)} disabled={verifying === c.id} className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] disabled:opacity-50">
                  {verifying === c.id ? "Verifying…" : "Re-verify"}
                </button>
                <a href={`/channels/${c.id}`} className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]">Placements →</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
