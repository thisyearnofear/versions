"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MarketplaceError,
  createRequestScope,
  marketplaceRequest,
  reservePlacement,
  type ChannelRecord,
  type MarketplaceListing,
  type UsageRecord,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { PublishingKit } from "@/components/marketplace/PublishingKit";
import { UsageReporter } from "@/components/usage/UsageReporter";
import { UsageHistory } from "@/components/marketplace/UsageHistory";
import { track } from "@/lib/analytics";

const ECONOMICS =
  "The channel operator pays for this placement. Paid spend is allocated 60% to the supplier, 30% to the channel, and 10% to VERSIONS.";

export function ListingActions({
  listing,
  initialChannelId = "",
}: {
  listing: MarketplaceListing;
  initialChannelId?: string;
}) {
  const { walletAddress } = useSupervisorAuth();
  return (
    <ListingActionsContent
      key={`${walletAddress ?? "guest"}:${listing.id}:${initialChannelId}`}
      listing={listing}
      initialChannelId={initialChannelId}
    />
  );
}

function ListingActionsContent({
  listing,
  initialChannelId,
}: {
  listing: MarketplaceListing;
  initialChannelId: string;
}) {
  const router = useRouter();
  const { isAuthenticated, walletAddress, address } = useSupervisorAuth();

  const [channels, setChannels] = useState<ChannelRecord[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageRecord[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [channelScope] = useState(() => createRequestScope());
  const [usageScope] = useState(() => createRequestScope());
  const [channelTick, setChannelTick] = useState(0);

  useEffect(() => {
    const { signal, isCurrent } = channelScope.start();
    const t = window.setTimeout(() => {
      if (!isCurrent()) return;
      if (!isAuthenticated) {
        setChannels(null);
        return;
      }
      setChannelsError(null);
      marketplaceRequest<{ channels: ChannelRecord[] }>("/api/v1/channels?limit=100", {
        signal,
      })
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
    () => (listing.tier === "paid" ? ownChannels.filter((c) => c.can_buy_slots) : ownChannels),
    [ownChannels, listing.tier],
  );
  const selectedChannel = ownChannels.find((c) => c.id === channelId) ?? null;
  const channelValid =
    !!selectedChannel && (listing.tier === "free" || selectedChannel.can_buy_slots);
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

  const isCpm = listing.pricing?.model === "cpm";
  const walletMismatch =
    isAuthenticated && !!walletAddress && !!address && address.toLowerCase() !== walletAddress.toLowerCase();
  const reserveDisabled =
    busy ||
    !channelValid ||
    walletMismatch ||
    (isCpm && !(Number(budget) > 0)) ||
    listing.status !== "active";

  const reserve = useCallback(async () => {
    if (!selectedChannel) return;
    setBusy(true);
    setError(null);
    try {
      const res = await reservePlacement(
        listing.id,
        selectedChannel.id,
        isCpm ? budget.trim() : null,
      );
      track("slot_intent", { listingId: listing.id, channelId: selectedChannel.id });
      router.push(`/placements/${res.slot.id}`);
    } catch (err) {
      setError(
        err instanceof MarketplaceError ? err.message : "Could not reserve this placement. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [listing.id, selectedChannel, isCpm, budget, router]);

  if (listing.status !== "active") {
    return (
      <div className="marketplace-kit" role="status">
        <h3 className="marketplace-heading">Use this listing</h3>
        <p className="mt-2 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
          This listing is {listing.status} and is not accepting new uses or placements.
        </p>
      </div>
    );
  }

  const channelPicker = (eligible: ChannelRecord[]) => (
    <>
      {channelsError ? (
        <div role="alert" className="mt-3">
          <p className="font-serif text-[14px] text-[var(--color-rust)]">{channelsError}</p>
          <button
            type="button"
            onClick={() => setChannelTick((t) => t + 1)}
            className="btn-secondary mt-2"
          >
            Retry
          </button>
        </div>
      ) : channels === null ? (
        <p className="mt-3 font-serif text-[14px] text-[var(--color-ink-2)]">Loading your channels…</p>
      ) : eligible.length === 0 ? (
        <p className="mt-3 font-serif text-[14px] text-[var(--color-ink-2)]">
          {listing.tier === "paid" ? (
            <>
              None of your channels are eligible for paid placements — a channel needs
              platform-verified reach first.{" "}
            </>
          ) : (
            <>Connect a channel first —{" "}</>
          )}
          <Link href="/channels" className="text-[var(--color-rust)] underline">
            {listing.tier === "paid" ? "Connect or verify a channel" : "Channels"}
          </Link>
          .
        </p>
      ) : (
        <label className="mt-3 grid gap-1">
          <span className="marketplace-label">Your channel</span>
          <select
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setUsage(null);
              setUsageError(null);
            }}
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px]"
          >
            <option value="">Pick a channel…</option>
            {eligible.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {invalidExplicitChannel && (
        <p className="mt-2 font-mono text-[12px] text-[var(--color-ink-3)]">
          The linked channel isn&apos;t one of yours — pick one of your own.
        </p>
      )}
      {walletMismatch && (
        <p role="alert" className="mt-2 font-serif text-[14px] text-[var(--color-rust)]">
          The connected wallet doesn&apos;t match the signed-in account — switch wallets or sign in again before continuing.
        </p>
      )}
    </>
  );

  return (
    <div className="marketplace-kit" aria-label="Use this listing">
      {listing.tier === "free" ? (
        <>
          <PublishingKit
            attributionText={listing.attribution_text}
            trackingUrl={listing.attribution_url}
            linkLabel="Attribution link"
            disclosure={listing.disclosure}
            audioPath={listing.audio_path}
            images={listing.images}
            reportHint={isAuthenticated && channelValid && !walletMismatch}
          />
          <div className="mt-4 border-t border-[var(--color-hair)] pt-4">
            <h3 className="marketplace-heading">Log where it ran</h3>
            {!isAuthenticated ? (
              <div className="mt-2">
                <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
                  Sign in and pick your channel to log the use against it.
                </p>
                <div className="mt-2">
                  <WagmiConnectButton variant="quiet" />
                </div>
              </div>
            ) : (
              <>
                {channelPicker(ownChannels)}
                {channelValid && selectedChannel && !walletMismatch && (
                  <div className="mt-3">
                    <UsageReporter
                      key={`${listing.id}:${selectedChannel.id}`}
                      defaultListingId={listing.id}
                      defaultChannelId={selectedChannel.id}
                      listingTitle={listing.title}
                      channelName={selectedChannel.name}
                      onReported={loadUsage}
                    />
                    <p className="mt-2 font-mono text-[12px] text-[var(--color-ink-3)]">
                      Publish first, then add its URL here. Copying credit does not log a use.
                    </p>
                    <div className="mt-3 border-t border-[var(--color-hair)] pt-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="marketplace-label">Recent reports</p>
                        <button
                          type="button"
                          onClick={loadUsage}
                          className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
                        >
                          Refresh
                        </button>
                      </div>
                      {usageError ? (
                        <p role="alert" className="mt-2 font-serif text-[14px] text-[var(--color-rust)]">
                          {usageError}
                        </p>
                      ) : usage === null ? (
                        <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">Loading…</p>
                      ) : (
                        <div className="mt-2">
                          <UsageHistory usage={usage} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <h3 className="marketplace-heading">Buy this placement</h3>
          <p className="mt-2 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">{ECONOMICS}</p>
          <p className="mt-1 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
            {isCpm
              ? "Your budget is held up front. Delivered spend is settled when you finish the placement; unused funds are returned."
              : "The flat fee is collected once; payout status is shown separately below."}
          </p>

          {!isAuthenticated ? (
            <div className="mt-3">
              <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
                Sign in to pick one of your verified channels and reserve this slot.
              </p>
              <div className="mt-2">
                <WagmiConnectButton variant="quiet" />
              </div>
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              {channelPicker(eligibleChannels)}
              {isCpm && channelValid && (
                <label className="grid gap-1">
                  <span className="marketplace-label">Budget (USDC) — escrowed up front</span>
                  <input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 50"
                    className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px]"
                  />
                </label>
              )}
              {channels !== null && eligibleChannels.length > 0 && !channelsError && (
                <div>
                  <button
                    type="button"
                    onClick={() => void reserve()}
                    disabled={reserveDisabled}
                    className="btn-primary disabled:opacity-50"
                  >
                    {busy ? "Reserving…" : "Reserve & review"}
                  </button>
                  <p className="mt-2 font-mono text-[12px] text-[var(--color-ink-3)]">
                    Reserving holds the slot — payment is a separate review step on the placement page.
                  </p>
                </div>
              )}
            </div>
          )}
          {error && (
            <div role="alert" className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)] p-3">
              <p className="font-serif text-[14px] text-[var(--color-rust)]">{error}</p>
              <button
                type="button"
                onClick={() => void reserve()}
                disabled={reserveDisabled}
                className="btn-secondary mt-2"
              >
                Retry
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
