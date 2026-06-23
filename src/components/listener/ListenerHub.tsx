"use client";

// MODULAR: Listener Hub — free plays meter, reputation score, badge showcase.
// Shows remaining free plays for the session, total reputation, and earned badges.
// Integrates into the Discover view to give listeners instant feedback.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { apiClient, type ListenerProfileResponse, type ListenerBadgeResponse } from "@/lib/api-client";
import { BadgeGrid } from "./ListenerBadge";
import { cn } from "@/lib/utils";

export function ListenerHub() {
  const { address, isConnected } = useAccount();
  const [profile, setProfile] = useState<ListenerProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!address) {
      setProfile(null);
      return;
    }
    setLoading(true);
    try {
      const p = await apiClient.getListenerProfile(address);
      setProfile(p);
    } catch {
      // Silently fail — the feature degrades gracefully
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Sync badge state after a play response
  const syncNewBadges = useCallback(
    (newBadges: ListenerBadgeResponse[]) => {
      if (!profile || newBadges.length === 0) return;
      // Merge new badges into existing ones (deduplicate by id)
      const existingIds = new Set(profile.badges.map((b) => b.id));
      const fresh = newBadges.filter((b) => !existingIds.has(b.id));
      if (fresh.length === 0) return;
      setProfile((prev) =>
        prev ? { ...prev, badges: [...fresh, ...prev.badges] } : prev,
      );
    },
    [profile],
  );

  // Expose sync function for DiscoverView to call after play
  useEffect(() => {
    if (typeof window !== "undefined") {
      const win = window as unknown as Record<string, unknown>;
      win.__listenerSyncNewBadges = syncNewBadges;
      win.__listenerFetchProfile = fetchProfile;
    }
    return () => {
      if (typeof window !== "undefined") {
        const win = window as unknown as Record<string, unknown>;
        delete win.__listenerSyncNewBadges;
        delete win.__listenerFetchProfile;
      }
    };
  }, [syncNewBadges, fetchProfile]);

  if (!isConnected || !address) return null;

  if (loading && !profile) {
    return <ListenerHubSkeleton />;
  }

  if (!profile) return null;

  const { freePlaysRemaining, freePlaysDailyLimit, reputationScore, badges } = profile;
  const freePct = freePlaysDailyLimit > 0 ? (freePlaysRemaining / freePlaysDailyLimit) * 100 : 0;
  const repLevel = reputationScore >= 500 ? "Tastemaker" : reputationScore >= 200 ? "Curator" : reputationScore >= 50 ? "Explorer" : "Listener";

  return (
    <div className="border-b border-[var(--color-hair)] pb-6 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Free plays meter */}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
              Free plays today
            </span>
            <span className="font-mono text-[11px] font-semibold text-[var(--color-rust)]">
              {freePlaysRemaining}/{freePlaysDailyLimit}
            </span>
          </div>
          <div className="h-2 bg-[var(--color-hair)] rounded-full overflow-hidden w-full max-w-[280px]">
            <div
              className="h-full bg-[var(--color-rust)] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.max(0, freePct)}%` }}
            />
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mt-1">
            {freePlaysRemaining > 0
              ? `${freePlaysRemaining} free pla${freePlaysRemaining === 1 ? "y" : "ys"} remaining — then $0.001 per play`
              : "Free plays exhausted — $0.001 USDC per play"}
          </p>
        </div>

        {/* Reputation */}
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mb-0.5">
            Reputation
          </div>
          <div className="font-mono text-lg font-bold tracking-tight text-[var(--color-ink)]">
            {reputationScore}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            {repLevel}
          </div>
        </div>
      </div>

      {/* Badge toggle */}
      {badges.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] hover:text-[var(--color-ink)] transition-colors"
        >
          {expanded ? "Hide badges" : `Show badges (${badges.length})`}
        </button>
      )}

      {expanded && badges.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--color-hair)]">
          <BadgeGrid badges={badges} size="sm" />
        </div>
      )}
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────

function ListenerHubSkeleton() {
  return (
    <div className="border-b border-[var(--color-hair)] pb-6 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="skel h-[10px] w-[120px] mb-2" />
          <div className="skel h-[8px] w-full max-w-[280px] rounded-full" />
          <div className="skel h-[9px] w-[140px] mt-2" />
        </div>
        <div className="text-right">
          <div className="skel h-[10px] w-[70px] mb-1 ml-auto" />
          <div className="skel h-[18px] w-[40px] ml-auto" />
          <div className="skel h-[9px] w-[50px] mt-1 ml-auto" />
        </div>
      </div>
    </div>
  );
}
