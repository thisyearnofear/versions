"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { MarketplaceError, browseHref, createRequestScope, marketplaceRequest } from "@/lib/marketplace-client";
import { ApiError } from "@/lib/api-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { useToast } from "@/components/ui/Toast";
import { agreementFor, AGREEMENT_VERSION } from "@/lib/agreement";
import { track } from "@/lib/analytics";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";

type Channel = {
  id: string;
  name: string;
  platform: string;
  platform_url: string;
  platform_channel_id: string | null;
  verification_status: "pending" | "verified" | "failed";
  verification_error: string | null;
  stats: { subscriber_count: number | null; view_count: string | null; video_count: number | null; source: string | null; verified_at: string | null };
  niche: string | null;
  ethos_summary: string | null;
  recent_content: string[];
  can_buy_slots: boolean;
  status: string;
};

function errMsg(err: unknown): string {
  if (err instanceof MarketplaceError) return err.message;
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function ChannelOnboarding() {
  const { walletAddress } = useSupervisorAuth();
  return <ChannelOnboardingContent key={walletAddress ?? "guest"} />;
}

function ChannelOnboardingContent() {
  const { showToast } = useToast();
  const { status: sessionStatus } = useSession();
  const isAuthed = sessionStatus === "authenticated";
  const [url, setUrl] = useState("");
  const [niche, setNiche] = useState("");
  const [ethos, setEthos] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Channel | null>(null);
  const agreement = useMemo(() => agreementFor("channel"), []);
  const [listScope] = useState(() => createRequestScope());

  const load = useCallback(() => {
    const { signal, isCurrent } = listScope.start();
    (async () => {
      if (!isAuthed) {
        setChannels([]);
        return;
      }
      try {
        const data = await marketplaceRequest<{ channels: Channel[] }>("/api/v1/channels?limit=12", { signal });
        if (!isCurrent()) return;
        setChannels(data.channels ?? []);
      } catch (e) {
        if (!isCurrent()) return;
        showToast(errMsg(e), "error");
      }
    })();
  }, [isAuthed, showToast, listScope]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      load();
    }, 0);
    return () => {
      window.clearTimeout(t);
      listScope.cancel();
    };
  }, [load, listScope]);

  const register = useCallback(async () => {
    if (!agree) {
      showToast("Accept the blanket agreement first.", "warning");
      return;
    }
    if (!url.trim()) {
      showToast("Paste a YouTube channel URL, @handle, or UC… id.", "warning");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const data = await marketplaceRequest<{ channel: Channel; alreadyRegistered?: boolean }>("/api/v1/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformUrl: url.trim(),
          niche: niche.trim() || null,
          ethosSummary: ethos.trim() || null,
          agreementVersion: AGREEMENT_VERSION,
        }),
      });
      track("channel_registered", { verified: data.channel.verification_status === "verified" });
      showToast(
        data.alreadyRegistered ? "That surface is already registered." : `Channel connected — ${data.channel.verification_status}.`,
        data.channel.verification_status === "verified" ? "success" : "info",
      );
      setRegistered(data.channel);
      load();
      if (!data.alreadyRegistered) {
        setUrl("");
      }
    } catch (e) {
      setFormError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [agree, url, niche, ethos, showToast, load]);

  const verify = useCallback(
    async (id: string) => {
      setVerifying(id);
      try {
        const data = await marketplaceRequest<{ channel: Channel }>(`/api/v1/channels/${id}/verify`, { method: "POST" });
        showToast(
          data.channel.verification_status === "verified" ? "Verified — paid placements unlocked." : `Still ${data.channel.verification_status}.`,
          data.channel.verification_status === "verified" ? "success" : "info",
        );
        load();
      } catch (e) {
        showToast(errMsg(e), "error");
      } finally {
        setVerifying(null);
      }
    },
    [showToast, load],
  );

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Save and verify">
      <p className="kicker">Save & verify</p>
      <h3 className="mt-1 font-serif text-xl font-black tracking-tight">Make it yours — then get paid for it.</h3>
      <p className="mt-1 max-w-xl font-serif text-sm leading-snug text-[var(--color-ink-2)]">
        The preview above ranked the catalog from what you typed. Saving binds that channel to your account — then we
        pull its real numbers from YouTube and <strong className="font-semibold text-[var(--color-ink)]">you keep 30%</strong> on every paid placement.
      </p>

      {!isAuthed ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)] px-4 py-4">
          <p className="font-serif text-[14px] font-semibold text-[var(--color-ink)]">Sign in to save this channel</p>
          <p className="mt-1 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
            The paste-and-preview above is free. Saving is what remembers it, verifies reach against the platform, and unlocks the 60/30/10 settlement on Arc.
          </p>
          <div className="mt-3">
            <WagmiConnectButton variant="quiet" />
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-3)]">
            Wallet is for money — sign-in is just to remember your channels.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="marketplace-label">YouTube channel (URL / @handle / UC…)</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/@yourchannel"
              className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 py-2.5 font-serif text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-rust)] focus:outline-none"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="marketplace-label">Niche (for matching)</span>
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. lo-fi study streams"
                maxLength={120}
                className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 py-2.5 font-serif text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-rust)] focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="marketplace-label">Ethos in your own words</span>
              <input
                value={ethos}
                onChange={(e) => setEthos(e.target.value)}
                placeholder="e.g. calm, analog, late-night"
                maxLength={1000}
                className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 py-2.5 font-serif text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-rust)] focus:outline-none"
              />
            </label>
          </div>

          <details>
            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
              Agreement ({AGREEMENT_VERSION})
            </summary>
            <div className="mt-3 space-y-2">
              {agreement.terms.map((t) => (
                <p key={t.slice(0, 40)} className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">
                  • {t}
                </p>
              ))}
              <p className="font-serif text-sm font-semibold italic text-[var(--color-ink)]">&ldquo;{agreement.acceptance}&rdquo;</p>
            </div>
          </details>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
            <span className="font-mono text-xs leading-snug text-[var(--color-ink-2)]">{agreement.acceptance}</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={register} disabled={busy || !agree} className="btn-primary disabled:opacity-50">
              {busy ? "Connecting…" : "Save & verify →"}
            </button>
            <span className="font-mono text-[11px] text-[var(--color-ink-3)]">You keep 30% on every paid placement once verified.</span>
          </div>
          {formError && (
            <p role="alert" className="font-serif text-[14px] text-[var(--color-rust)]">
              {formError}
            </p>
          )}
        </div>
      )}

      {registered && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-rust)] bg-[var(--color-paper-2)] p-3">
          <p className="font-serif text-[14px] font-semibold text-[var(--color-ink)]">
            {registered.name} — {registered.verification_status === "verified" ? "verified, paid placements unlocked." : "connected, pending verification."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/channels/${registered.id}`} className="btn-secondary">
              Open channel workspace →
            </Link>
            <Link href={browseHref({ channelId: registered.id })} className="btn-secondary">
              Browse matched supply →
            </Link>
          </div>
        </div>
      )}

      {channels.length > 0 && (
        <div className="mt-6 grid gap-3">
          <p className="kicker">Your channels</p>
          {channels.map((c) => (
            <div key={c.id} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/channels/${c.id}`} className="font-serif text-sm font-semibold hover:text-[var(--color-rust)]">
                  {c.name}
                </Link>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${c.verification_status === "verified" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : c.verification_status === "pending" ? "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]" : "bg-[var(--color-rust)] text-white"}`}
                >
                  {c.verification_status === "pending" ? (c.stats.source === "mock" ? "pending · demo" : "pending") : c.verification_status}
                  {c.can_buy_slots ? " · can buy" : ""}
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-[11px] text-[var(--color-ink-3)]">{c.platform_url}</p>
              <p className="mt-1 font-mono text-[11px] text-[var(--color-ink-2)]">
                {c.stats.subscriber_count != null ? `${c.stats.subscriber_count.toLocaleString()} subs` : "—"} ·{" "}
                {c.stats.view_count != null ? `${Number(c.stats.view_count).toLocaleString()} views` : "—"} · {c.stats.video_count ?? "—"} videos ·{" "}
                <span className="text-[var(--color-ink-3)]">{c.stats.source ?? "—"}</span>
                {c.niche ? ` · niche: ${c.niche}` : ""}
              </p>
              {c.verification_error && <p className="mt-1 font-mono text-[10px] text-[var(--color-rust)]">{c.verification_error}</p>}
              {c.recent_content.length > 0 && (
                <p className="mt-2 font-mono text-[10px] leading-snug text-[var(--color-ink-3)]">Recent: {c.recent_content.slice(0, 3).join(" · ")}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void verify(c.id)}
                  disabled={verifying === c.id}
                  className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] disabled:opacity-50"
                >
                  {verifying === c.id ? "Verifying…" : "Re-verify"}
                </button>
                <Link
                  href={`/channels/${c.id}`}
                  className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
                >
                  Workspace →
                </Link>
                <Link
                  href={browseHref({ channelId: c.id })}
                  className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
                >
                  Browse matches →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
