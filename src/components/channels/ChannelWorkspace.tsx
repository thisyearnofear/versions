"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MarketplaceError,
  browseHref,
  createRequestScope,
  marketplaceRequest,
  mediaHref,
  type ChannelRecord,
  type MarketplaceListing,
  type SlotRecord,
  type UsageRecord,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { UsageHistory } from "@/components/marketplace/UsageHistory";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { ChannelEarnings } from "@/components/channels/ChannelEarnings";
import type { ChannelEarnings as ChannelEarningsData } from "@/services/slots";

function statsSourceLabel(source: string | null): string {
  if (source === "platform_api") return "platform-verified";
  if (source === "mock") return "demo numbers — not verified";
  return "unverified";
}

export function ChannelWorkspace({ channelId }: { channelId: string }) {
  const { walletAddress } = useSupervisorAuth();
  return (
    <ChannelWorkspaceContent
      key={`${walletAddress ?? "guest"}:${channelId}`}
      channelId={channelId}
    />
  );
}

function ChannelWorkspaceContent({ channelId }: { channelId: string }) {
  const { isAuthenticated } = useSupervisorAuth();

  const [channel, setChannel] = useState<ChannelRecord | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerDataError, setOwnerDataError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotRecord[] | null>(null);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [listingNames, setListingNames] = useState<Record<string, string>>({});
  const [earnings, setEarnings] = useState<ChannelEarningsData | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope] = useState(() => createRequestScope());

  const loadEarnings = useCallback(
    (isOwnerNow: boolean) => {
      if (!isOwnerNow) {
        setEarnings(null);
        setEarningsError(null);
        setEarningsLoading(false);
        return;
      }
      const { signal, isCurrent } = scope.start();
      setEarningsLoading(true);
      setEarningsError(null);
      (async () => {
        try {
          const data = await marketplaceRequest<{ earnings: ChannelEarningsData }>(
            `/api/v1/channels/${encodeURIComponent(channelId)}/earnings`,
            { signal },
          );
          if (!isCurrent()) return;
          setEarnings(data.earnings);
        } catch (err) {
          if (!isCurrent()) return;
          const msg =
            err instanceof MarketplaceError && err.status === 404
              ? null
              : err instanceof MarketplaceError
                ? err.message
                : "Earnings unavailable — retry to load it.";
          if (msg) setEarningsError(msg);
        } finally {
          if (isCurrent()) setEarningsLoading(false);
        }
      })();
    },
    [channelId, scope],
  );

  const load = useCallback(() => {
    const { signal, isCurrent } = scope.start();
    setError(null);
    setOwnerDataError(null);
    setUsageError(null);
    (async () => {
      let channel: ChannelRecord;
      try {
        const data = await marketplaceRequest<{ channel: ChannelRecord }>(
          `/api/v1/channels/${encodeURIComponent(channelId)}`,
          { signal },
        );
        channel = data.channel;
      } catch (err) {
        if (!isCurrent()) return;
        setError(err instanceof MarketplaceError ? err.message : "Could not load this channel.");
        setLoading(false);
        return;
      }
      if (!isCurrent()) return;
      setChannel(channel);

      const [usageRes, ownRes, slotsRes] = await Promise.allSettled([
        marketplaceRequest<{ usage: UsageRecord[] }>(
          `/api/v1/usage?channelId=${encodeURIComponent(channelId)}&limit=50`,
          { signal },
        ),
        isAuthenticated
          ? marketplaceRequest<{ channels: ChannelRecord[] }>("/api/v1/channels?limit=100", { signal })
          : Promise.resolve({ channels: [] as ChannelRecord[] }),
        isAuthenticated
          ? marketplaceRequest<{ slots: SlotRecord[] }>("/api/v1/slots?limit=100", { signal })
          : Promise.resolve({ slots: [] as SlotRecord[] }),
      ]);
      if (!isCurrent()) return;

      if (usageRes.status === "fulfilled") {
        setUsage(usageRes.value.usage ?? []);
      } else {
        setUsageError("Usage history unavailable — retry to load it.");
      }

      if (ownRes.status === "rejected" || slotsRes.status === "rejected") {
        setOwnerDataError(
          "Your account data could not be loaded — placements and ownership can't be confirmed. Retry to check.",
        );
        setIsOwner(false);
        setSlots(null);
      } else {
        const owned = (ownRes.value.channels ?? []).some((c) => c.id === channel.id);
        setIsOwner(owned);
        loadEarnings(owned);
        const channelSlots = (slotsRes.value.slots ?? []).filter(
          (s) => s.channel_id === channel.id,
        );
        setSlots(owned ? channelSlots : []);

        const names: Record<string, string> = {};
        await Promise.all(
          channelSlots.map(async (s) => {
            if (names[s.listing_id]) return;
            const data = await marketplaceRequest<{ listing: MarketplaceListing }>(
              `/api/v1/listings/${encodeURIComponent(s.listing_id)}`,
              { signal },
            ).catch(() => null);
            if (data?.listing) names[s.listing_id] = data.listing.title;
          }),
        );
        if (!isCurrent()) return;
        setListingNames(names);
      }
      setLoading(false);
    })();
  }, [channelId, isAuthenticated, scope, loadEarnings]);

  useEffect(() => {
    const t = window.setTimeout(load, 0);
    return () => {
      window.clearTimeout(t);
      scope.cancel();
    };
  }, [load, scope]);

  const channelUrl = useMemo(
    () => (channel ? mediaHref(channel.platform_url) : null),
    [channel],
  );

  if (loading) {
    return <p className="py-10 font-serif text-[15px] text-[var(--color-ink-2)]">Loading channel…</p>;
  }
  if (error || !channel) {
    return (
      <div className="py-10">
        <p role="alert" className="font-serif text-[15px] text-[var(--color-rust)]">
          {error ?? "Channel not found."}
        </p>
        <button type="button" onClick={load} className="btn-secondary mt-3">
          Retry
        </button>
      </div>
    );
  }

  const verified =
    channel.verification_status === "verified" && channel.stats.source === "platform_api";
  const statsChecked = channel.stats.verified_at
    ? `${channel.stats.source === "platform_api" ? "Verified" : "Checked"} ${new Date(channel.stats.verified_at).toLocaleDateString()}`
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-serif text-2xl font-black tracking-tight sm:text-3xl">{channel.name}</h1>
          <span
            className={`rounded-full px-3 py-1 font-mono text-[12px] uppercase tracking-wide ${
              verified
                ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                : "border border-[var(--color-hair-strong)] text-[var(--color-ink-2)]"
            }`}
          >
            {verified
              ? "Verified"
              : channel.verification_status === "pending"
                ? channel.stats.source === "mock"
                  ? "Pending · demo"
                  : "Pending"
                : "Verification failed"}
          </span>
        </div>
        <p className="mt-1 font-serif text-[15px] text-[var(--color-ink-2)]">
          {channel.platform}
          {channel.niche ? ` · ${channel.niche}` : ""}
          {channelUrl && (
            <>
              {" · "}
              <a href={channelUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--color-rust)] underline">
                View on platform
              </a>
            </>
          )}
        </p>
        {channel.ethos_summary && (
          <p className="mt-3 max-w-2xl font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
            {channel.ethos_summary}
          </p>
        )}

        <div className="marketplace-kit mt-5">
          <h3 className="marketplace-heading">Reach</h3>
          <p className="mt-2 font-serif text-[15px] text-[var(--color-ink-2)]">
            {channel.stats.subscriber_count != null
              ? `${channel.stats.subscriber_count.toLocaleString()} subscribers`
              : "Subscribers unknown"}
            {" · "}
            {channel.stats.view_count != null
              ? `${Number(channel.stats.view_count).toLocaleString()} views`
              : "Views unknown"}
            {" · "}
            {channel.stats.video_count != null ? `${channel.stats.video_count} videos` : "Videos unknown"}
          </p>
          <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-3)]">
            Source: {statsSourceLabel(channel.stats.source)}
            {statsChecked ? ` · ${statsChecked}` : ""}
          </p>
          {!verified && (
            <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">
              {isOwner
                ? "Paid placements unlock once reach is verified against the platform."
                : "This channel is pending verification — its numbers are placeholders."}
            </p>
          )}
          {channel.verification_error && isOwner && (
            <p className="mt-1 font-mono text-[12px] text-[var(--color-rust)]">{channel.verification_error}</p>
          )}
        </div>

        {channel.recent_content.length > 0 && (
          <div className="mt-5">
            <h3 className="marketplace-heading">Recent uploads</h3>
            <ul className="mt-2 grid gap-1">
              {channel.recent_content.slice(0, 8).map((line, i) => (
                <li key={i} className="font-serif text-[14px] text-[var(--color-ink-2)]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6">
          <h3 className="marketplace-heading">Usage history</h3>
          {usageError ? (
            <div className="mt-2">
              <p role="alert" className="font-serif text-[14px] text-[var(--color-rust)]">{usageError}</p>
              <button type="button" onClick={load} className="btn-secondary mt-1">
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
          <h3 className="marketplace-heading">Matched supply</h3>
          <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">
            Browse listings ranked by this channel&apos;s ethos.
          </p>
          <Link
            href={browseHref({ channelId: channel.id })}
            className="btn-primary mt-3 inline-block"
          >
            Browse matched supply
          </Link>
        </div>

        {/* Keep rate + settled earnings — the "can I make money?" rung. */}
        {isOwner ? (
          <div className="mt-4">
            <ChannelEarnings
              earnings={earnings}
              loading={earningsLoading}
              error={earningsError}
              onRetry={() => loadEarnings(true)}
            />
          </div>
        ) : (
          <div className="marketplace-kit mt-4">
            <h3 className="marketplace-heading">How this channel gets paid</h3>
            <p className="mt-2 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
              A paid placement on this channel settles flat <strong className="font-semibold text-[var(--color-ink)]">60% supplier · 30% channel · 10% platform</strong>. The channel’s cut is a <code className="rounded bg-[var(--color-paper-2)] px-1 py-0.5 font-mono text-[11px]">slot_legs</code> paid to the channel wallet on Arc — the operator’s settled total is visible only to them.
            </p>
            {!isAuthenticated && (
              <div className="mt-3">
                <WagmiConnectButton variant="quiet" />
              </div>
            )}
          </div>
        )}

        {ownerDataError ? (
          <div className="marketplace-kit mt-4" role="alert">
            <h3 className="marketplace-heading">Placements</h3>
            <p className="mt-2 font-serif text-[14px] text-[var(--color-rust)]">{ownerDataError}</p>
            <button type="button" onClick={load} className="btn-secondary mt-2">
              Retry
            </button>
          </div>
        ) : isOwner ? (
          <div className="marketplace-kit mt-4">
            <h3 className="marketplace-heading">Your placements</h3>
            {slots === null ? (
              <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">Loading…</p>
            ) : slots.length === 0 ? (
              <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">
                No placements yet — reserve one from a paid listing.
              </p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {slots.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/placements/${s.id}`}
                      className="flex min-h-[44px] items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 hover:border-[var(--color-rust)]"
                    >
                      <span className="font-serif text-[14px] text-[var(--color-ink)]">
                        {listingNames[s.listing_id] ?? "Placement"}
                      </span>
                      <span className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)]">
                        {s.status.replace(/_/g, " ")}
                        {s.payment_mock ? " · demo" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="marketplace-kit mt-4">
            <h3 className="marketplace-heading">Placements</h3>
            {!isAuthenticated ? (
              <div className="mt-2">
                <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
                  Sign in to see your placements on this channel.
                </p>
                <div className="mt-2">
                  <WagmiConnectButton variant="quiet" />
                </div>
              </div>
            ) : (
              <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">
                Placement history is visible to the channel operator.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
