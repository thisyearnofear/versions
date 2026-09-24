"use client";

// BuyBox — the decision surface on /listings/:id.
// Price is the headline (field 1), not the footnote. One primary CTA
// per tier, sticky on desktop, honest about what happens next.
// Speaks like the ICP's tools (NCS, Etsy, BrandConnect), not like our
// internals.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MarketplaceError,
  createRequestScope,
  listingPriceBadge,
  marketplaceRequest,
  reservePlacement,
  type ChannelRecord,
  type MarketplaceListing,
  type UsageRecord,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { AddToKitButton } from "@/components/marketplace/AddToKitButton";
import { PriceBadge } from "@/components/marketplace/PriceBadge";
import { UsageReporter } from "@/components/usage/UsageReporter";
import { UsageHistory } from "@/components/marketplace/UsageHistory";
import { track } from "@/lib/analytics";
import { useToast } from "@/components/ui/Toast";

export function BuyBox({
  listing,
  initialChannelId = "",
}: {
  listing: MarketplaceListing;
  initialChannelId?: string;
}) {
  const { walletAddress } = useSupervisorAuth();
  return (
    <BuyBoxContent
      key={`${walletAddress ?? "guest"}:${listing.id}:${initialChannelId}`}
      listing={listing}
      initialChannelId={initialChannelId}
    />
  );
}

function BuyBoxContent({
  listing,
  initialChannelId,
}: {
  listing: MarketplaceListing;
  initialChannelId: string;
}) {
  const router = useRouter();
  const { isAuthenticated, walletAddress, address } = useSupervisorAuth();
  const { showToast } = useToast();

  const [channels, setChannels] = useState<ChannelRecord[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [usage, setUsage] = useState<UsageRecord[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [channelScope] = useState(() => createRequestScope());
  const [usageScope] = useState(() => createRequestScope());
  const [channelTick, setChannelTick] = useState(0);

  const isFree = listing.tier === "free";
  const isCpm = listing.pricing?.model === "cpm";
  const isActive = listing.status === "active";

  useEffect(() => {
    const { signal, isCurrent } = channelScope.start();
    const t = window.setTimeout(() => {
      if (!isCurrent()) return;
      if (!isAuthenticated) {
        setChannels(null);
        return;
      }
      setChannelsError(null);
      marketplaceRequest<{ channels: ChannelRecord[] }>("/api/v1/channels?limit=100", { signal })
        .then((data) => {
          if (isCurrent()) setChannels(data.channels ?? []);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          setChannelsError(err instanceof Error ? err.message : "Could not load your channels.");
        });
    }, 0);
    return () => {
      window.clearTimeout(t);
      channelScope.cancel();
    };
  }, [isAuthenticated, channelTick, channelScope]);

  const ownChannels = useMemo(() => channels ?? [], [channels]);
  const eligibleChannels = useMemo(
    () => (isFree ? ownChannels : ownChannels.filter((c) => c.can_buy_slots)),
    [ownChannels, isFree],
  );
  const selectedChannel = ownChannels.find((c) => c.id === channelId) ?? null;
  const channelValid = !!selectedChannel && (isFree || selectedChannel.can_buy_slots);
  const invalidExplicitChannel =
    !!initialChannelId && channels !== null && !ownChannels.some((c) => c.id === initialChannelId);

  const loadUsage = useCallback(() => {
    const { signal, isCurrent } = usageScope.start();
    setUsageError(null);
    marketplaceRequest<{ usage: UsageRecord[] }>(
      `/api/v1/usage?listingId=${encodeURIComponent(listing.id)}&limit=100`,
      { signal },
    )
      .then((data) => {
        if (!isCurrent()) return;
        setUsage((data.usage ?? []).filter((u) => u.channel_id === channelId));
      })
      .catch((err) => {
        if (!isCurrent()) return;
        setUsage(null);
        setUsageError(
          err instanceof MarketplaceError ? err.message : "Recent reports are unavailable right now.",
        );
      });
  }, [listing.id, channelId, usageScope]);

  useEffect(() => {
    if (!channelValid) {
      usageScope.cancel();
      return;
    }
    const t = window.setTimeout(loadUsage, 0);
    return () => {
      window.clearTimeout(t);
      usageScope.cancel();
    };
  }, [channelValid, loadUsage, usageScope]);

  const walletMismatch =
    isAuthenticated && !!walletAddress && !!address && address.toLowerCase() !== walletAddress.toLowerCase();

  const reserveDisabled =
    busy || !channelValid || walletMismatch || (isCpm && !(Number(budget) > 0)) || !isActive;

  const copyCredit = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(listing.attribution_text);
      setCopyState("copied");
      track("kit_copy", { listingId: listing.id, tier: listing.tier });
      showToast("Credit copied — paste it in your description.", "success", 3000);
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("failed");
    }
  }, [listing.attribution_text, listing.id, listing.tier, showToast]);

  const reserve = useCallback(async () => {
    if (!selectedChannel) return;
    setBusy(true);
    setError(null);
    try {
      const res = await reservePlacement(listing.id, selectedChannel.id, isCpm ? budget.trim() : null);
      track("slot_intent", { listingId: listing.id, channelId: selectedChannel.id });
      router.push(`/placements/${res.slot.id}`);
    } catch (err) {
      setError(err instanceof MarketplaceError ? err.message : "Could not reserve this placement. Try again.");
    } finally {
      setBusy(false);
    }
  }, [listing.id, selectedChannel, isCpm, budget, router]);

  // Price headline — the single most important read on the surface.
  const priceLine = useMemo(() => {
    if (isFree) return { headline: "Free", sub: "with required credit", badge: listingPriceBadge(listing) };
    if (isCpm) return { headline: listing.pricing?.cpmUsdc ?? "—", unit: "USDC", sub: "per 1,000 views", badge: listingPriceBadge(listing) };
    return { headline: listing.pricing?.flatFeeUsdc ?? "—", unit: "USDC", sub: "flat fee", badge: listingPriceBadge(listing) };
  }, [isFree, isCpm, listing]);

  if (!isActive) {
    return (
      <div className="marketplace-kit lg:sticky lg:top-6" role="status">
        <p className="kicker">Not available</p>
        <p className="mt-2 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
          This listing is <strong className="font-semibold text-[var(--color-ink)]">{listing.status}</strong> — it is not taking new uses or buys right now.
        </p>
        <Link href="/discover" className="btn-secondary mt-4 w-full">
          Browse the catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="marketplace-kit flex flex-col gap-0 lg:sticky lg:top-6">
      {/* ── Price — the first thing a buyer scans ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            {isFree ? "Use it free" : "Buy this placement"}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-serif leading-none">
            <span className="text-3xl font-black tracking-tight text-[var(--color-ink)]">
              {priceLine.headline}
              {"unit" in priceLine && priceLine.unit ? (
                <span className="ml-1 text-[15px] font-semibold text-[var(--color-ink-2)]">{priceLine.unit}</span>
              ) : null}
            </span>
            <span className="font-mono text-[12px] text-[var(--color-ink-3)]">{priceLine.sub}</span>
          </p>
          {!isFree && listing.budget_remaining_usdc != null && (
            <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-3)]">
              Campaign left:{" "}
              <span className="font-semibold text-[var(--color-ink-2)]">{listing.budget_remaining_usdc} USDC</span>
            </p>
          )}
          {!isFree && listing.budget_remaining_usdc == null && (
            <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-3)]">Uncapped campaign</p>
          )}
        </div>
        <PriceBadge listing={listing} />
      </div>

      {/* ── Disclosure — required, but never the headline ── */}
      {listing.disclosure && (
        <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)]/20 bg-[var(--color-rust-soft)] px-3 py-2 font-serif text-[13px] leading-snug text-[var(--color-ink)]">
          <span className="rounded bg-[var(--color-rust)] px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-white">
            {listing.disclosure.label}
          </span>{" "}
          <span className="ml-1">{listing.disclosure.statement}</span>
        </p>
      )}

      {/* ── Economics — one line, honest, ICP-native ── */}
      {!isFree ? (
        <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-paper-2)] px-3 py-2 font-mono text-[11px] leading-snug text-[var(--color-ink-3)]">
          Settles <strong className="font-semibold text-[var(--color-ink-2)]">60% supplier · 30% to your channel · 10% platform</strong> on Arc. Your 30% lands as a <code className="rounded bg-white px-1">slot_leg</code>.
        </p>
      ) : (
        <p className="mt-3 font-mono text-[11px] leading-snug text-[var(--color-ink-3)]">
          One blanket agreement covers it —{" "}
          <Link href="/legal/agreement" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
            no per-track deal
          </Link>
          . Copy the credit, publish, then log where it ran.
        </p>
      )}

      <hr className="my-4 border-[var(--color-hair)]" />

      {/* ── Channel — who this is for ── */}
      {!isAuthenticated ? (
        <div>
          <p className="marketplace-label">Channel</p>
          <p className="mt-1 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
            {isFree ? "Pick your channel to log where it ran — or use it now and log it after." : "Pick the verified channel this placement will run on."}
          </p>
          <div className="mt-2">
            <WagmiConnectButton variant="quiet" />
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-3)]">Sign in to choose a channel. Browsing is free.</p>
        </div>
      ) : channelsError ? (
        <div role="alert">
          <p className="font-serif text-[14px] text-[var(--color-rust)]">{channelsError}</p>
          <button type="button" onClick={() => setChannelTick((t) => t + 1)} className="btn-secondary mt-2">
            Retry
          </button>
        </div>
      ) : channels === null ? (
        <p className="font-serif text-[14px] text-[var(--color-ink-2)]">Loading your channels…</p>
      ) : eligibleChannels.length === 0 ? (
        <p className="font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
          {isFree ? (
            <>
              No channels yet —{" "}
              <Link href="/channels" className="text-[var(--color-rust)] underline">
                connect a channel
              </Link>{" "}
              to log uses, or use it now.
            </>
          ) : (
            <>
              No verified channels for paid buys yet —{" "}
              <Link href="/channels" className="text-[var(--color-rust)] underline">
                verify a channel
              </Link>{" "}
              to unlock placements.
            </>
          )}
        </p>
      ) : (
        <label className="grid gap-1">
          <span className="marketplace-label">Run on</span>
          <select
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setUsage(null);
              setUsageError(null);
              setShowReport(false);
            }}
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 font-serif text-[15px] text-[var(--color-ink)]"
          >
            <option value="">Choose a channel…</option>
            {eligibleChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {isFree ? "" : c.can_buy_slots ? "" : " · needs verification"}
              </option>
            ))}
          </select>
          {invalidExplicitChannel && (
            <span className="font-mono text-[12px] text-[var(--color-ink-3)]">
              The linked channel isn&apos;t one of yours — pick one of your own.
            </span>
          )}
          {walletMismatch && (
            <span role="alert" className="font-serif text-[13px] text-[var(--color-rust)]">
              Wallet mismatch — switch to the wallet you signed in with.
            </span>
          )}
          {selectedChannel && !isFree && !selectedChannel.can_buy_slots && (
            <span className="font-mono text-[12px] text-[var(--color-rust)]">
              This channel needs platform-verified reach before it can buy.
            </span>
          )}
        </label>
      )}

      {/* ── Budget (CPM only) — escrow, not spend ── */}
      {!isFree && isCpm && isAuthenticated && channelValid && (
        <label className="mt-3 grid gap-1">
          <span className="marketplace-label">Your budget — escrowed up front, only delivered spend settles</span>
          <span className="relative flex">
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              placeholder="50"
              className="min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 pr-16 font-serif text-[15px]"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-[var(--color-ink-3)]">
              USDC
            </span>
          </span>
          <span className="font-mono text-[11px] text-[var(--color-ink-3)]">
            CPM is {listing.pricing?.cpmUsdc} USDC / 1k views. Unspent budget is returned when you finish.
          </span>
        </label>
      )}

      {/* ── Primary CTA — one, full-width, marketplace verb ── */}
      <div className="mt-4">
        {isFree ? (
          <>
            <button type="button" onClick={() => void copyCredit()} className="btn-primary w-full">
              {copyState === "copied" ? "Copied ✓" : copyState === "failed" ? "Copy failed — select manually" : "Copy credit — use it now"}
            </button>
            <p className="mt-2 text-center font-mono text-[11px] text-[var(--color-ink-3)]">
              Render the credit exactly as written. Copying does not log a use.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void reserve()}
              disabled={reserveDisabled}
              className="btn-primary w-full disabled:opacity-50"
            >
              {busy ? "Reserving…" : isCpm ? "Reserve this slot" : "Buy this placement"}
            </button>
            <p className="mt-2 text-center font-mono text-[11px] text-[var(--color-ink-3)]">
              Reserves the slot — you review and pay on the next step. No charge until you confirm.
            </p>
          </>
        )}
        {error && (
          <div role="alert" className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)] bg-white p-3">
            <p className="font-serif text-[14px] text-[var(--color-rust)]">{error}</p>
            {!isFree && (
              <button type="button" onClick={() => void reserve()} disabled={reserveDisabled} className="btn-secondary mt-2">
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Secondary — keep it quiet, never competes with primary ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-hair)] pt-3">
        <AddToKitButton listing={listing} channelId={channelId || null} />
        <span className="font-mono text-[11px] text-[var(--color-ink-3)]">
          {isFree ? "Save for later — no account needed" : "Shortlist it first"}
        </span>
      </div>

      {/* ── Free: where the credit actually lives (not the headline, the follow-through) ── */}
      {isFree && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 py-3">
          <p className="marketplace-label">Credit to render</p>
          <p className="mt-1 select-all break-words rounded-[var(--radius-sm)] bg-[var(--color-paper-2)] px-2.5 py-2 font-mono text-[12px] leading-snug text-[var(--color-ink)]">
            {listing.attribution_text}
          </p>
          <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-3)]">
            Link:{" "}
            <a href={listing.attribution_url} className="break-all text-[var(--color-rust)] underline">
              {listing.attribution_url}
            </a>
          </p>
        </div>
      )}

      {/* ── Post-use reporting — de-prioritized, honest, only when relevant ── */}
      {isFree && isAuthenticated && channelValid && !walletMismatch && (
        <div className="mt-4 border-t border-[var(--color-hair)] pt-4">
          {!showReport ? (
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
            >
              Log where it ran ↓
            </button>
          ) : (
            <>
              <h3 className="marketplace-heading">Log where it ran</h3>
              <p className="mt-1 font-mono text-[11px] text-[var(--color-ink-3)]">Publish first, then add the URL here.</p>
              <div className="mt-3">
                <UsageReporter
                  key={`${listing.id}:${channelId}`}
                  defaultListingId={listing.id}
                  defaultChannelId={channelId}
                  listingTitle={listing.title}
                  channelName={selectedChannel?.name}
                  onReported={loadUsage}
                />
              </div>
              <div className="mt-4 border-t border-[var(--color-hair)] pt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="marketplace-label">Recent reports for this channel</p>
                  <button
                    type="button"
                    onClick={loadUsage}
                    className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
                  >
                    Refresh
                  </button>
                </div>
                {usageError ? (
                  <p role="alert" className="mt-2 font-serif text-[13px] text-[var(--color-rust)]">
                    {usageError}
                  </p>
                ) : usage === null ? (
                  <p className="mt-2 font-serif text-[13px] text-[var(--color-ink-2)]">Loading…</p>
                ) : (
                  <div className="mt-2">
                    <UsageHistory usage={usage} />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowReport(false)}
                className="mt-3 font-mono text-[11px] text-[var(--color-ink-3)] underline hover:text-[var(--color-ink-2)]"
              >
                Hide
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Agreement — last, always ── */}
      <p className="mt-4 border-t border-[var(--color-hair)] pt-3 text-center font-mono text-[11px] text-[var(--color-ink-3)]">
        Covered by the{" "}
        <Link href="/legal/agreement" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
          blanket agreement
        </Link>
        .
      </p>
    </div>
  );
}
