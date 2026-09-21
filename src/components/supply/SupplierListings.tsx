"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MarketplaceError,
  createRequestScope,
  marketplaceRequest,
  settlementLabel,
  type ListingRecord,
  type SlotLegRecord,
  type SlotRecord,
  type UsageRecord,
} from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { UsageHistory } from "@/components/marketplace/UsageHistory";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { shortHash } from "@/lib/explorer";

interface ListingActivity {
  usage: UsageRecord[];
  slots: Array<{ slot: SlotRecord; legs: SlotLegRecord[] | null }>;
}

export function SupplierListings({ refreshKey = 0 }: { refreshKey?: number }) {
  const { walletAddress } = useSupervisorAuth();
  return <SupplierListingsContent key={walletAddress ?? "guest"} refreshKey={refreshKey} />;
}

function SupplierListingsContent({ refreshKey }: { refreshKey: number }) {
  const { isAuthenticated } = useSupervisorAuth();
  const [listings, setListings] = useState<ListingRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, ListingActivity | "error">>({});
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [listScope] = useState(() => createRequestScope());
  const [activityScope] = useState(() => createRequestScope());

  const load = useCallback(() => {
    const { signal, isCurrent } = listScope.start();
    marketplaceRequest<{ listings: ListingRecord[] }>("/api/v1/listings?mine=1&limit=100", { signal })
      .then((data) => {
        if (!isCurrent()) return;
        setListings(data.listings ?? []);
        setError(null);
      })
      .catch((err) => {
        if (!isCurrent()) return;
        setError(err instanceof MarketplaceError ? err.message : "Could not load your listings.");
      });
  }, [listScope]);

  const loadActivity = useCallback(
    (id: string) => {
      setActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const { signal, isCurrent } = activityScope.start();
      (async () => {
        try {
          const [usageData, slotsData] = await Promise.all([
            marketplaceRequest<{ usage: UsageRecord[] }>(
              `/api/v1/usage?listingId=${encodeURIComponent(id)}&limit=50`,
              { signal },
            ),
            marketplaceRequest<{ slots: SlotRecord[] }>(
              `/api/v1/slots?listingId=${encodeURIComponent(id)}&limit=50`,
              { signal },
            ),
          ]);
          const slotsWithLegs = await Promise.all(
            (slotsData.slots ?? []).map(async (slot) => {
              const detail = await marketplaceRequest<{ legs: SlotLegRecord[] }>(
                `/api/v1/slots/${encodeURIComponent(slot.id)}`,
                { signal },
              ).catch(() => null);
              return { slot, legs: detail?.legs ?? null };
            }),
          );
          if (!isCurrent()) return;
          setActivity((prev) => ({
            ...prev,
            [id]: { usage: usageData.usage ?? [], slots: slotsWithLegs },
          }));
        } catch {
          if (!isCurrent()) return;
          setActivity((prev) => ({ ...prev, [id]: "error" }));
        }
      })();
    },
    [activityScope],
  );

  const expandedRef = useRef<string | null>(null);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const refresh = useCallback(() => {
    load();
    if (expandedRef.current) loadActivity(expandedRef.current);
  }, [load, loadActivity]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!isAuthenticated) {
        setListings(null);
        return;
      }
      refresh();
    }, 0);
    return () => {
      window.clearTimeout(t);
      listScope.cancel();
      activityScope.cancel();
    };
  }, [isAuthenticated, refresh, refreshKey, listScope, activityScope]);

  const toggleExpand = useCallback(
    (id: string) => {
      if (expanded === id) {
        setExpanded(null);
        return;
      }
      setExpanded(id);
      if (activity[id] && activity[id] !== "error") return;
      loadActivity(id);
    },
    [expanded, activity, loadActivity],
  );

  const setStatus = useCallback(
    async (id: string, status: "active" | "paused") => {
      setBusyStatus(id);
      setError(null);
      try {
        await marketplaceRequest(`/api/v1/listings/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        refresh();
      } catch (err) {
        setError(err instanceof MarketplaceError ? err.message : "Could not update the listing.");
      } finally {
        setBusyStatus(null);
      }
    },
    [refresh],
  );

  if (!isAuthenticated) {
    return (
      <div className="marketplace-kit">
        <h3 className="marketplace-heading">Your listings</h3>
        <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">
          Sign in to see and manage your supply.
        </p>
        <div className="mt-2">
          <WagmiConnectButton variant="quiet" />
        </div>
      </div>
    );
  }

  return (
    <section className="marketplace-kit" aria-label="Your listings">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="marketplace-heading">Your listings</h3>
        <button
          type="button"
          onClick={refresh}
          className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 font-serif text-[14px] text-[var(--color-rust)]">
          {error}
        </p>
      )}
      {listings === null ? (
        <p className="mt-3 font-serif text-[14px] text-[var(--color-ink-2)]">Loading…</p>
      ) : listings.length === 0 ? (
        <p className="mt-3 font-serif text-[14px] text-[var(--color-ink-2)]">
          No listings yet — create one above.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {listings.map((l) => {
            const act = activity[l.id];
            return (
              <li key={l.id} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/listings/${l.id}`}
                    className="font-serif text-[15px] font-semibold text-[var(--color-ink)] hover:text-[var(--color-rust)]"
                  >
                    {l.title}
                  </Link>
                  <span className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)]">
                    {l.kind} · {l.tier} · {l.status}
                  </span>
                </div>
                <p className="mt-0.5 font-serif text-[13px] text-[var(--color-ink-2)]">{l.supplier_name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={`/listings/${l.id}`} className="btn-secondary">
                    View listing
                  </Link>
                  {l.status === "active" && (
                    <button
                      type="button"
                      onClick={() => void setStatus(l.id, "paused")}
                      disabled={busyStatus === l.id}
                      className="btn-secondary disabled:opacity-50"
                    >
                      Pause
                    </button>
                  )}
                  {l.status === "paused" && (
                    <button
                      type="button"
                      onClick={() => void setStatus(l.id, "active")}
                      disabled={busyStatus === l.id}
                      className="btn-secondary disabled:opacity-50"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleExpand(l.id)}
                    className="min-h-[44px] rounded-full border border-[var(--color-hair-strong)] px-4 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
                  >
                    {expanded === l.id ? "Hide activity" : "Activity"}
                  </button>
                </div>
                {expanded === l.id && (
                  <div className="mt-3 border-t border-[var(--color-hair)] pt-3">
                    {!act ? (
                      <p className="font-serif text-[14px] text-[var(--color-ink-2)]">Loading activity…</p>
                    ) : act === "error" ? (
                      <div>
                        <p role="alert" className="font-serif text-[14px] text-[var(--color-rust)]">
                          Activity could not be loaded.
                        </p>
                        <button
                          type="button"
                          onClick={() => loadActivity(l.id)}
                          className="btn-secondary mt-1"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <>
                        {act.slots.length > 0 && (
                          <div className="mb-3">
                            <p className="marketplace-label">Placements</p>
                            <ul className="mt-1 grid gap-1.5">
                              {act.slots.map(({ slot, legs }) => (
                                <li key={slot.id} className="font-mono text-[12px] text-[var(--color-ink-2)]">
                                  <Link
                                    href={`/placements/${slot.id}`}
                                    className="text-[var(--color-rust)] underline"
                                  >
                                    {slot.status.replace(/_/g, " ")}
                                  </Link>
                                  {` · recorded spend ${slot.spent_usdc} USDC${slot.payment_mock ? " · demo" : ""}`}
                                  {legs === null
                                    ? " · settlement pending retrieval"
                                    : legs.length > 0 &&
                                      ` · ${legs.map((leg) => `${leg.recipient_role}: ${leg.amount_usdc} (${settlementLabel(slot, leg)})${leg.tx_hash && !slot.payment_mock ? ` ${shortHash(leg.tx_hash)}` : ""}`).join(", ")}`}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="marketplace-label">Usage</p>
                        <div className="mt-1">
                          <UsageHistory usage={act.usage} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
