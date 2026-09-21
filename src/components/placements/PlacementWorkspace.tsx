"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import {
  MarketplaceError,
  completePlacement,
  createRequestScope,
  marketplaceRequest,
  payPlacement,
  setPlacementAction,
  settlementLabel,
  type ChannelRecord,
  type MarketplaceListing,
  type SlotLegRecord,
  type SlotRecord,
  type UsageRecord,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { txUrl, shortHash } from "@/lib/explorer";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { PublishingKit } from "@/components/marketplace/PublishingKit";
import { UsageHistory } from "@/components/marketplace/UsageHistory";
import { UsageReporter } from "@/components/usage/UsageReporter";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";

const ECONOMICS =
  "The channel operator pays for this placement. Paid spend is allocated 60% to the supplier, 30% to the channel, and 10% to VERSIONS.";

interface SlotDetail {
  slot: SlotRecord;
  legs: SlotLegRecord[];
}

function statusLabel(status: SlotRecord["status"]): string {
  return status.replace(/_/g, " ");
}

export function PlacementWorkspace({ slotId }: { slotId: string }) {
  const { walletAddress } = useSupervisorAuth();
  return (
    <PlacementWorkspaceContent
      key={`${walletAddress ?? "guest"}:${slotId}`}
      slotId={slotId}
    />
  );
}

function PlacementWorkspaceContent({ slotId }: { slotId: string }) {
  const { isAuthenticated, walletAddress } = useSupervisorAuth();
  const { address } = useAccount();

  const [slot, setSlot] = useState<SlotRecord | null>(null);
  const [legs, setLegs] = useState<SlotLegRecord[]>([]);
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelRecord | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [scope] = useState(() => createRequestScope());

  const isOwner =
    isAuthenticated &&
    !!slot &&
    !!walletAddress &&
    slot.buyer_wallet.toLowerCase() === walletAddress.toLowerCase();
  const walletMismatch =
    isAuthenticated && !!walletAddress && !!address && address.toLowerCase() !== walletAddress.toLowerCase();

  const load = useCallback(() => {
    const { signal, isCurrent } = scope.start();
    setLoadError(null);
    setListingError(null);
    setUsageError(null);
    setChannelError(null);
    (async () => {
      let detail: SlotDetail;
      try {
        detail = await marketplaceRequest<SlotDetail>(
          `/api/v1/slots/${encodeURIComponent(slotId)}`,
          { signal },
        );
      } catch (err) {
        if (!isCurrent()) return;
        setLoadError(
          err instanceof MarketplaceError ? err.message : "Could not load this placement.",
        );
        setLoading(false);
        return;
      }
      if (!isCurrent()) return;
      setSlot(detail.slot);
      setLegs(detail.legs ?? []);

      const [listingRes, usageRes, channelRes] = await Promise.allSettled([
        marketplaceRequest<{ listing: MarketplaceListing }>(
          `/api/v1/listings/${encodeURIComponent(detail.slot.listing_id)}`,
          { signal },
        ),
        marketplaceRequest<{ usage: UsageRecord[] }>(
          `/api/v1/usage?slotId=${encodeURIComponent(slotId)}`,
          { signal },
        ),
        marketplaceRequest<{ channel: ChannelRecord }>(
          `/api/v1/channels/${encodeURIComponent(detail.slot.channel_id)}`,
          { signal },
        ),
      ]);
      if (!isCurrent()) return;
      if (listingRes.status === "fulfilled") {
        setListing(listingRes.value.listing);
      } else {
        setListing(null);
        setListingError(
          listingRes.reason instanceof MarketplaceError
            ? listingRes.reason.message
            : "The listing for this placement could not be loaded.",
        );
      }
      if (usageRes.status === "fulfilled") {
        setUsage(usageRes.value.usage ?? []);
      } else {
        setUsageError("Delivery history unavailable — retry to load it.");
      }
      if (channelRes.status === "fulfilled") {
        setChannel(channelRes.value.channel);
      } else {
        const reason = channelRes.reason;
        if (reason instanceof MarketplaceError && reason.status === 404) {
          setChannel(null);
        } else {
          setChannelError("The channel for this placement could not be loaded — retry to check.");
        }
      }
      setLoading(false);
    })();
  }, [slotId, scope]);

  useEffect(() => {
    const t = window.setTimeout(load, 0);
    return () => {
      window.clearTimeout(t);
      scope.cancel();
    };
  }, [load, scope]);

  const refreshUsage = useCallback(async () => {
    const { signal, isCurrent } = scope.start();
    try {
      const data = await marketplaceRequest<{ usage: UsageRecord[] }>(
        `/api/v1/usage?slotId=${encodeURIComponent(slotId)}`,
        { signal },
      );
      if (!isCurrent()) return;
      setUsage(data.usage ?? []);
      setUsageError(null);
      const detail = await marketplaceRequest<SlotDetail>(
        `/api/v1/slots/${encodeURIComponent(slotId)}`,
        { signal },
      );
      if (!isCurrent()) return;
      setSlot(detail.slot);
      setLegs(detail.legs ?? []);
    } catch {
      if (isCurrent()) setUsageError("Refresh failed — showing the last loaded record.");
    }
  }, [slotId, scope]);

  const pay = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await payPlacement(slotId);
      setSlot(res.slot);
      setLegs(res.legs ?? []);
      await refreshUsage();
    } catch (err) {
      const ambiguous =
        !(err instanceof MarketplaceError) ||
        err.code === "RESPONSE_UNCONFIRMED" ||
        err.status >= 500;
      setActionError(
        ambiguous
          ? "Payment status could not be confirmed. Refresh this placement before trying again — the request may have completed."
          : err.message,
      );
      load();
    } finally {
      setBusy(false);
    }
  }, [slotId, refreshUsage, load]);

  const complete = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await completePlacement(slotId);
      setSlot(res.slot);
      setLegs(res.legs ?? []);
      setConfirmComplete(false);
      await refreshUsage();
    } catch (err) {
      setActionError(
        err instanceof MarketplaceError ? err.message : "Settlement failed. Try again.",
      );
      load();
    } finally {
      setBusy(false);
    }
  }, [slotId, refreshUsage, load]);

  const pauseResume = useCallback(
    async (action: "pause" | "resume") => {
      setBusy(true);
      setActionError(null);
      try {
        const updated = await setPlacementAction(slotId, action);
        setSlot(updated);
      } catch (err) {
        setActionError(
          err instanceof MarketplaceError ? err.message : "Could not update this placement.",
        );
      } finally {
        setBusy(false);
      }
    },
    [slotId],
  );

  if (loading) {
    return <p className="py-10 font-serif text-[15px] text-[var(--color-ink-2)]">Loading placement…</p>;
  }
  if (loadError || !slot) {
    return (
      <div className="py-10">
        <p role="alert" className="font-serif text-[15px] text-[var(--color-rust)]">
          {loadError ?? "Placement not found."}
        </p>
        <button type="button" onClick={load} disabled={busy} className="btn-secondary mt-3 disabled:opacity-50">
          Retry
        </button>
      </div>
    );
  }

  const gross =
    slot.pricing_model === "flat" ? slot.flat_fee_usdc : slot.budget_usdc;
  const isPending = slot.status === "pending_payment";
  const isLive = slot.status === "active" || slot.status === "paused" || slot.status === "exhausted";
  const servable = slot.status === "active";
  const spendLabel = slot.pricing_model === "flat" ? "Charged flat fee" : "Accrued spend";
  const mockSuffix = slot.payment_mock ? " · demo" : "";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-serif text-2xl font-black tracking-tight sm:text-3xl">
            {listing ? listing.title : "Placement"}
          </h1>
          <span className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)]">
            {statusLabel(slot.status)}
            {mockSuffix}
          </span>
        </div>
        <p className="mt-1 font-serif text-[15px] text-[var(--color-ink-2)]">
          {listing?.supplier_name ?? ""}
          {channel ? ` · on ${channel.name}` : ""}
        </p>
        {listingError && (
          <div role="alert" className="mt-2">
            <p className="font-serif text-[14px] text-[var(--color-rust)]">{listingError}</p>
            <button type="button" onClick={load} disabled={busy} className="btn-secondary mt-1 disabled:opacity-50">
              Retry
            </button>
          </div>
        )}
        {channelError && (
          <div role="alert" className="mt-2">
            <p className="font-serif text-[14px] text-[var(--color-rust)]">{channelError}</p>
            <button type="button" onClick={load} disabled={busy} className="btn-secondary mt-1 disabled:opacity-50">
              Retry
            </button>
          </div>
        )}

        {listing && (
          <div className="mt-4">
            <ListingMedia
              title={listing.title}
              kind={listing.kind}
              audioPath={listing.audio_path}
              images={listing.images}
              coverSvg={listing.cover_svg}
            />
          </div>
        )}

        {isPending && (
          <div className="marketplace-kit mt-6">
            <h3 className="marketplace-heading">Reserved materials — activate to publish</h3>
            <p className="mt-2 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
              Attribution — render this credit exactly as written:
            </p>
            <p className="mt-1 break-words rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)] px-3 py-2.5 font-mono text-[13px] leading-snug text-[var(--color-ink)]">
              {slot.attribution_text}
            </p>
            {slot.disclosure && (
              <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)]/40 bg-[var(--color-rust-soft)] px-3 py-2 font-serif text-[14px] leading-snug text-[var(--color-ink)]">
                <strong className="font-semibold">{slot.disclosure.label}</strong> — {slot.disclosure.statement}
              </p>
            )}
            <p className="mt-2 font-mono text-[12px] text-[var(--color-ink-3)]">
              The tracking link activates on payment.
            </p>
          </div>
        )}

        {isLive && (
          <div className="mt-6">
            <PublishingKit
              attributionText={slot.attribution_text}
              trackingUrl={slot.tracking_url}
              disclosure={slot.disclosure}
              audioPath={listing?.audio_path}
              images={listing?.images}
              reportHint={isOwner && servable && !walletMismatch}
            />
          </div>
        )}

        {!isPending && !isLive && (
          <div className="mt-6">
            <p className="marketplace-label mb-2">
              Historical publishing materials — this placement is not accepting delivery
            </p>
            <PublishingKit
              attributionText={slot.attribution_text}
              trackingUrl={slot.tracking_url}
              disclosure={slot.disclosure}
              audioPath={listing?.audio_path}
              images={listing?.images}
              reportHint={false}
            />
          </div>
        )}

        {isOwner && servable && !walletMismatch && (
          <div className="marketplace-kit mt-6">
            <h3 className="marketplace-heading">Report delivery</h3>
            <div className="mt-3">
              <UsageReporter
                defaultListingId={slot.listing_id}
                defaultChannelId={slot.channel_id}
                slotId={slot.id}
                listingTitle={listing?.title}
                channelName={channel?.name}
                onReported={() => void refreshUsage()}
              />
            </div>
          </div>
        )}
        {isOwner && walletMismatch && (
          <p role="alert" className="mt-6 font-serif text-[14px] text-[var(--color-rust)]">
            The connected wallet doesn&apos;t match the signed-in account — switch wallets or sign in again to manage this placement.
          </p>
        )}

        <div className="mt-6">
          <h3 className="marketplace-heading">Delivery history</h3>
          {usageError ? (
            <div className="mt-2">
              <p role="alert" className="font-serif text-[14px] text-[var(--color-rust)]">{usageError}</p>
              <button type="button" onClick={() => void refreshUsage()} disabled={busy} className="btn-secondary mt-1 disabled:opacity-50">
                Retry
              </button>
            </div>
          ) : (
            <div className="mt-2">
              <UsageHistory usage={usage} />
            </div>
          )}
        </div>
      </div>

      <aside className="min-w-0">
        <div className="marketplace-kit">
          <h3 className="marketplace-heading">Placement</h3>
          <dl className="mt-3 grid gap-2 font-serif text-[14px] text-[var(--color-ink-2)]">
            <div className="flex justify-between gap-3">
              <dt className="marketplace-label shrink-0">Model</dt>
              <dd className="text-right">{slot.pricing_model === "flat" ? "Flat fee" : "CPM"}</dd>
            </div>
            {slot.pricing_model === "flat" && (
              <div className="flex justify-between gap-3">
                <dt className="marketplace-label shrink-0">Flat fee</dt>
                <dd className="text-right">
                  {slot.flat_fee_usdc} USDC{mockSuffix}
                </dd>
              </div>
            )}
            {slot.pricing_model === "cpm" && (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="marketplace-label shrink-0">CPM</dt>
                  <dd className="text-right">
                    {slot.cpm_usdc} USDC{mockSuffix}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="marketplace-label shrink-0">Budget</dt>
                  <dd className="text-right">
                    {slot.budget_usdc ?? "—"} USDC{mockSuffix}
                  </dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-3">
              <dt className="marketplace-label shrink-0">{spendLabel}</dt>
              <dd className="text-right">
                {slot.spent_usdc} USDC{mockSuffix}
              </dd>
            </div>
            {slot.budget_remaining_usdc != null && (
              <div className="flex justify-between gap-3">
                <dt className="marketplace-label shrink-0">Budget remaining</dt>
                <dd className="text-right">
                  {slot.budget_remaining_usdc} USDC{mockSuffix}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-3 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">{ECONOMICS}</p>
          {slot.pricing_model === "cpm" && (
            <p className="mt-1 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
              Your budget is held up front. Delivered spend is settled when you finish the placement; unused funds are returned.
            </p>
          )}
          {slot.pricing_model === "flat" && (
            <p className="mt-1 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
              The flat fee is collected once; payout status is shown separately below.
            </p>
          )}

          {!isAuthenticated ? (
            <div className="mt-4">
              <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
                Sign in as the buying channel to manage this placement.
              </p>
              <div className="mt-2">
                <WagmiConnectButton variant="quiet" />
              </div>
            </div>
          ) : !isOwner ? (
            <p className="mt-4 font-serif text-[14px] text-[var(--color-ink-2)]">
              Read-only — this placement belongs to another channel operator.
            </p>
          ) : isPending ? (
            <div className="mt-4">
              <p className="font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
                Review and activate: {gross} USDC{mockSuffix}
                {slot.pricing_model === "cpm" ? " (held as budget)" : ""}.
              </p>
              {walletMismatch ? (
                <p role="alert" className="mt-3 font-serif text-[14px] text-[var(--color-rust)]">
                  The connected wallet doesn&apos;t match the signed-in account — switch wallets or sign in again to pay.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void pay()}
                  disabled={busy}
                  className="btn-primary mt-3 disabled:opacity-50"
                >
                  {busy ? "Paying…" : `Pay ${gross} USDC & activate`}
                </button>
              )}
            </div>
          ) : isLive ? (
            <div className="mt-4 grid gap-2">
              {slot.status === "active" && (
                <button
                  type="button"
                  onClick={() => void pauseResume("pause")}
                  disabled={busy || walletMismatch}
                  className="btn-secondary disabled:opacity-50"
                >
                  Pause delivery
                </button>
              )}
              {slot.status === "paused" && (
                <button
                  type="button"
                  onClick={() => void pauseResume("resume")}
                  disabled={busy || walletMismatch}
                  className="btn-secondary disabled:opacity-50"
                >
                  Resume delivery
                </button>
              )}
              {!confirmComplete ? (
                <button
                  type="button"
                  onClick={() => setConfirmComplete(true)}
                  disabled={busy || walletMismatch}
                  className="btn-primary disabled:opacity-50"
                >
                  Finish placement
                </button>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-rust)] p-3">
                  <p className="font-serif text-[14px] leading-snug text-[var(--color-ink)]">
                    Finish placement and settle delivered spend? Any unused CPM budget will be returned.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void complete()}
                      disabled={busy || walletMismatch}
                      className="btn-primary disabled:opacity-50"
                    >
                      {busy ? "Settling…" : "Confirm finish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmComplete(false)}
                      disabled={busy}
                      className="btn-secondary"
                    >
                      Keep running
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {actionError && (
            <div role="alert" className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)] p-3">
              <p className="font-serif text-[14px] text-[var(--color-rust)]">{actionError}</p>
            </div>
          )}

          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="mt-4 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)] disabled:opacity-50"
          >
            Refresh status
          </button>
        </div>

        <div className="marketplace-kit mt-4">
          <h3 className="marketplace-heading">Payout status</h3>
          {legs.length === 0 ? (
            <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">
              {slot.payment_mock
                ? "Demo settlement — no on-chain legs."
                : isPending
                  ? "No payout yet — payment hasn't run."
                  : "No settlement legs recorded yet."}
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {legs.map((leg, i) => (
                <li key={i} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-serif text-[14px] font-semibold capitalize text-[var(--color-ink)]">
                      {leg.recipient_role}
                    </span>
                    <span className="font-mono text-[12px] text-[var(--color-ink-2)]">
                      {leg.amount_usdc} USDC · {settlementLabel(slot, leg)}
                    </span>
                  </div>
                  {leg.tx_hash && !slot.payment_mock && (
                    <a
                      href={txUrl(leg.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-block font-mono text-[12px] text-[var(--color-rust)] underline"
                    >
                      {shortHash(leg.tx_hash)} on Arc
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {listing && (
          <p className="mt-4 font-mono text-[12px] text-[var(--color-ink-3)]">
            Listing:{" "}
            <Link href={`/listings/${listing.id}`} className="text-[var(--color-rust)] underline">
              {listing.title}
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}
