"use client";

// MODULAR: Listener dashboard — full listener profile with play history,
// badge showcase, and reputation stats. Mirrors the artist/curator
// dashboard patterns but focused on the listener experience.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { BadgeGrid } from "@/components/listener/ListenerBadge";
import {
  apiClient,
  type ListenerProfileResponse,
  type PlayHistoryEntry,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PaginationControls } from "@/components/ui/PaginationControls";

// ── Types ──────────────────────────────────────────────

interface DashboardData {
  profile: ListenerProfileResponse;
  history: PlayHistoryEntry[];
  historyTotal: number;
}

type DashboardTab = "overview" | "history" | "badges";

// ── Labels ─────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  settled: "Settled",
  pending: "Pending",
  failed: "Failed",
};

const STATUS_COLORS: Record<string, string> = {
  settled: "text-[var(--color-rust)]",
  pending: "text-[var(--color-ink-3)]",
  failed: "text-[var(--color-ink-2)]",
};

const REP_LEVELS = [
  { min: 500, label: "Tastemaker", icon: "👑" },
  { min: 200, label: "Curator", icon: "🎵" },
  { min: 50, label: "Explorer", icon: "🎧" },
  { min: 0, label: "Listener", icon: "🎶" },
];

function getRepLevel(score: number): { label: string; icon: string } {
  for (const level of REP_LEVELS) {
    if (score >= level.min) return level;
  }
  return REP_LEVELS[REP_LEVELS.length - 1];
}

function nextRepThreshold(score: number): number | null {
  for (const level of REP_LEVELS) {
    if (score < level.min) return level.min;
  }
  return null;
}

function formatWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ── Component ──────────────────────────────────────────

const PAGE_SIZE = 25;

export function ListenerDashboard({ wallet }: { wallet: string }) {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [page, setPage] = useState(0);
  const [filterPlayType, setFilterPlayType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");

  const isOwn = isConnected && address?.toLowerCase() === wallet.toLowerCase();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrlSyncDone = useRef(false);

  const filterOpts = useCallback((): { playType?: string; status?: string; dateFrom?: string; dateTo?: string } => {
    const opts: { playType?: string; status?: string; dateFrom?: string; dateTo?: string } = {};
    if (filterPlayType) opts.playType = filterPlayType;
    if (filterStatus) opts.status = filterStatus;
    if (filterDateFrom) opts.dateFrom = filterDateFrom;
    if (filterDateTo) opts.dateTo = filterDateTo;
    return opts;
  }, [filterPlayType, filterStatus, filterDateFrom, filterDateTo]);

  // Fetch a specific page of history (0-indexed)
  const fetchPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const offset = targetPage * PAGE_SIZE;
      const historyRes = await apiClient.getListenerHistory(wallet, {
        limit: PAGE_SIZE,
        offset,
        ...filterOpts(),
      });
      setData((prev) =>
        prev
          ? { ...prev, history: historyRes.rows, historyTotal: historyRes.total }
          : null,
      );
      setPage(targetPage);
    } catch (err) {
      showToast(`Failed to load page: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [wallet, showToast, filterOpts]);

  // Initial full load
  const refresh = useCallback(async (initialPage?: number, filters?: { playType?: string; status?: string; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    try {
      const page = initialPage ?? 0;
      const offset = page * PAGE_SIZE;
      const [profile, historyRes] = await Promise.all([
        apiClient.getListenerProfile(wallet),
        apiClient.getListenerHistory(wallet, { limit: PAGE_SIZE, offset, ...(filters ?? filterOpts()) }),
      ]);
      setData({
        profile,
        history: historyRes.rows,
        historyTotal: historyRes.total,
      });
      setPage(page);
    } catch (err) {
      showToast(`Dashboard load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [wallet, showToast]);

  // Initial load — read page and tab from URL
  useEffect(() => {
    if (initialUrlSyncDone.current) return;
    const urlPage = searchParams.get("page");
    const initialPage = urlPage ? Math.max(0, parseInt(urlPage, 10) || 0) : 0;
    const urlTab = searchParams.get("tab");

    // Build filter params from URL (pass directly to avoid double-fetch)
    const urlPlayType = searchParams.get("playType");
    const urlStatus = searchParams.get("status");
    const urlDateFrom = searchParams.get("dateFrom");
    const urlDateTo = searchParams.get("dateTo");
    const filters: { playType?: string; status?: string; dateFrom?: string; dateTo?: string } = {};
    if (urlPlayType === "free" || urlPlayType === "paid") {
      filters.playType = urlPlayType;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterPlayType(urlPlayType);
    }
    if (urlStatus === "settled" || urlStatus === "pending" || urlStatus === "failed") {
      filters.status = urlStatus;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterStatus(urlStatus);
    }
    if (urlDateFrom) {
      filters.dateFrom = urlDateFrom;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterDateFrom(urlDateFrom);
    }
    if (urlDateTo) {
      filters.dateTo = urlDateTo;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterDateTo(urlDateTo);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(initialPage, Object.keys(filters).length > 0 ? filters : undefined);

    if (urlTab && ["overview", "history", "badges"].includes(urlTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(urlTab as DashboardTab);
    }

    initialUrlSyncDone.current = true;
  }, [refresh, searchParams]);

  // Re-fetch page 0 when filters change
  useEffect(() => {
    if (!initialUrlSyncDone.current) return;
    if (activeTab !== "history") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPlayType, filterStatus, filterDateFrom, filterDateTo]);

  // Sync URL with active tab, history page, and filters
  useEffect(() => {
    if (!initialUrlSyncDone.current) return;
    const params = new URLSearchParams();      params.set("tab", activeTab);
    if (activeTab === "history") {
      params.set("page", String(page));
      if (filterPlayType) params.set("playType", filterPlayType);
      if (filterStatus) params.set("status", filterStatus);
      if (filterDateFrom) params.set("dateFrom", filterDateFrom);
      if (filterDateTo) params.set("dateTo", filterDateTo);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, [activeTab, page, filterPlayType, filterStatus, filterDateFrom, filterDateTo, router]);

  // ── Loading ──────────────────────────────────────────
  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="border-t border-b border-[var(--color-hair)] py-10 font-serif text-[var(--color-ink-2)] text-center">
        <strong className="block text-[var(--color-ink)] font-medium mb-1">Could not load listener dashboard.</strong>
        <button
          type="button"
          onClick={() => void refresh()}
          className="font-mono text-[11px] uppercase tracking-[0.18em] mt-4 border border-[var(--color-ink)] px-4 py-2 hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const { profile, history } = data;
  const repLevel = getRepLevel(profile.reputationScore);
  const nextThreshold = nextRepThreshold(profile.reputationScore);
  const repProgress = nextThreshold
    ? Math.min(100, (profile.reputationScore / nextThreshold) * 100)
    : 100;

  // ── Tabs ─────────────────────────────────────────────
  const tabs: Array<{ id: DashboardTab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "history", label: "History", count: data.historyTotal },
    { id: "badges", label: "Badges", count: profile.badges.length },
  ];

  return (
    <div>
      {/* ── Dashboard header ────────────────────────────── */}
      <header className="border-t border-[var(--color-ink)] pt-8 pb-6 mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-3">
              {isOwn ? "Your Listener Profile" : "Listener Dashboard"}
            </p>
            <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-2">
              {isOwn ? "Your Dashboard" : "Listener"}
            </h2>
            <code className="font-mono text-[11px] text-[var(--color-ink-2)] bg-[var(--color-paper-2)] px-2 py-1 border border-[var(--color-hair-strong)]">
              {formatWallet(wallet)}
            </code>
          </div>
          <div className="flex gap-6 md:gap-10">
            <StatBlock label="Reputation" value={profile.reputationScore} />
            <StatBlock label="Plays" value={profile.totalPlays} />
            <StatBlock label="Badges" value={profile.badges.length} />
          </div>
        </div>
      </header>

      {/* ── Tab nav ─────────────────────────────────────── */}
      <nav role="tablist" className="flex overflow-x-auto border-b border-[var(--color-hair-strong)] mb-8">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-4 border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id
                ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                : "border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-[var(--color-paper-2)] rounded-none">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Overview Tab ────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Reputation + stats */}
          <section>
            <h3 className="font-serif text-xl font-black tracking-tight mb-4">Reputation</h3>
            <div className="border border-[var(--color-hair-strong)] p-5 mb-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">
                    Level
                  </div>
                  <div className="font-serif text-2xl font-black">
                    {repLevel.icon} {repLevel.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">
                    Score
                  </div>
                  <div className="font-serif text-3xl font-black tabular-nums">
                    {profile.reputationScore}
                  </div>
                </div>
              </div>
              {nextThreshold && (
                <div>
                  <div className="h-2 bg-[var(--color-hair)] rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-[var(--color-rust)] rounded-full transition-all duration-500"
                      style={{ width: `${repProgress}%` }}
                    />
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                    {nextThreshold - profile.reputationScore} pts to next level
                  </div>
                </div>
              )}
            </div>

            {/* Free plays meter */}
            <div className="border border-[var(--color-hair-strong)] p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-2">
                Free plays today
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-serif text-3xl font-black tabular-nums">
                  {profile.freePlaysRemaining}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-ink-2)]">
                  / {profile.freePlaysDailyLimit}
                </span>
              </div>
              <div className="h-2 bg-[var(--color-hair)] rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-[var(--color-rust)] rounded-full transition-all duration-500"
                  style={{
                    width: `${profile.freePlaysDailyLimit > 0 ? (profile.freePlaysRemaining / profile.freePlaysDailyLimit) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                {profile.freePlaysUsedToday} used today
              </div>
            </div>
          </section>

          {/* Stats summary */}
          <section>
            <h3 className="font-serif text-xl font-black tracking-tight mb-4">Activity</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total plays" value={profile.totalPlays} />
              <StatCard label="Paid plays" value={profile.totalPaidPlays} />
              <StatCard label="Free plays" value={profile.totalFreePlays} />
              <StatCard label="Distinct tracks" value={profile.distinctTracksPlayed} />
            </div>

            {/* Recent play activity */}
            <h3 className="font-serif text-xl font-black tracking-tight mt-8 mb-4">Recent plays</h3>
            {history.length === 0 ? (
              <p className="font-serif italic text-[var(--color-ink-3)] py-8 text-center border border-[var(--color-hair)]">
                No plays yet. Discover playlists to start listening.
              </p>
            ) : (
              <ul className="flex flex-col">
                {history.slice(0, 6).map((e) => (
                  <li
                    key={e.id}
                    className="py-3 border-t border-[var(--color-hair)] last:border-b"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-[var(--color-ink)] truncate">
                          {e.title ?? "Unknown track"}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                          {e.artistName ?? "Unknown artist"}
                          {e.playlistName && <> · {e.playlistName}</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {e.playType === "free" ? (
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-rust)]">
                            Free
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]">
                            $0.001
                          </span>
                        )}
                        <span className={cn(
                          "font-mono text-[10px]",
                          STATUS_COLORS[e.status] ?? "text-[var(--color-ink-3)]",
                        )}>
                          {STATUS_LABELS[e.status] ?? e.status}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ── History Tab ──────────────────────────────────── */}
      {activeTab === "history" && (
        <section>
          {/* ── Filter bar ──────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1">
              Type
            </label>
            <select
              value={filterPlayType}
              onChange={(e) => setFilterPlayType(e.target.value)}
              className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)]"
            >
              <option value="">All</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>

            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1 ml-3">
              Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)]"
            >
              <option value="">All</option>
              <option value="settled">Settled</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>

            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1 ml-3">
              From
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)] w-[140px]"
            />

            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1">
              To
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)] w-[140px]"
            />

            {/* Active filter indicator */}
            {(filterPlayType || filterStatus || filterDateFrom || filterDateTo) && (
              <button
                type="button"
                onClick={() => {
                  setFilterPlayType("");
                  setFilterStatus("");
                  setFilterDateFrom("");
                  setFilterDateTo("");
                }}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-rust)] ml-auto hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border border-[var(--color-hair)]">
              {filterPlayType || filterStatus || filterDateFrom || filterDateTo
                ? "No plays match the current filters."
                : "No play history yet. Start discovering music to build your history."}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-[var(--color-hair-strong)]">
                      <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Date</th>
                      <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Track</th>
                      <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Artist</th>
                      <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Playlist</th>
                      <th className="text-center py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Type</th>
                      <th className="text-right py-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((e) => (
                      <tr key={e.id} className="border-b border-[var(--color-hair)]">
                        <td className="py-3 pr-4 text-[var(--color-ink-2)] whitespace-nowrap">
                          {formatDate(e.playedAt)} <span className="text-[var(--color-ink-3)]">{formatTime(e.playedAt)}</span>
                        </td>
                        <td className="py-3 pr-4 truncate max-w-[160px]">
                          {e.title ?? "—"}
                        </td>
                        <td className="py-3 pr-4 truncate max-w-[120px] text-[var(--color-ink-2)]">
                          {e.artistName ?? "—"}
                        </td>
                        <td className="py-3 pr-4 truncate max-w-[140px] text-[var(--color-ink-2)]">
                          {e.playlistName ?? "—"}
                        </td>
                        <td className="py-3 pr-4 text-center">
                          {e.playType === "free" ? (
                            <span className="text-[var(--color-rust)] font-medium">Free</span>
                          ) : (
                            <span className="text-[var(--color-ink-2)]">Paid</span>
                          )}
                        </td>
                        <td className={cn(
                          "py-3 text-right tabular-nums",
                          STATUS_COLORS[e.status] ?? "text-[var(--color-ink-3)]",
                        )}>
                          {STATUS_LABELS[e.status] ?? e.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.historyTotal > 0 && (
                <PaginationControls
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={data.historyTotal}
                  loading={loading}
                  onPrev={() => void fetchPage(page - 1)}
                  onNext={() => void fetchPage(page + 1)}
                  onGoTo={(p) => void fetchPage(p)}
                />
              )}
            </>
          )}
        </section>
      )}

      {/* ── Badges Tab ───────────────────────────────────── */}
      {activeTab === "badges" && (
        <section>
          <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug max-w-2xl mb-8">
            Badges are milestone achievements earned through listening engagement.
            Keep discovering new music to unlock the next tier.
          </p>

          {profile.badges.length === 0 ? (
            <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border border-[var(--color-hair)]">
              No badges yet. Play your first track to earn the Early Adopter badge.
            </p>
          ) : (
            <div>
              {/* Badge grid */}
              <div className="mb-8">
                <BadgeGrid badges={profile.badges} size="md" />
              </div>

              {/* Badge progress */}
              <h3 className="font-serif text-xl font-black tracking-tight mb-4">Progress</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BadgeProgressCard
                    label="Explorer"
                    icon="🎧"
                    description="Listen to 10 different tracks"
                    current={profile.distinctTracksPlayed}
                    target={10}
                    earned={profile.badges.some((b) => b.badgeType === "explorer")}
                  />
                  <BadgeProgressCard
                    label="Supporter"
                    icon="⭐"
                    description="Make 50 paid plays"
                    current={profile.totalPaidPlays}
                    target={50}
                    earned={profile.badges.some((b) => b.badgeType === "supporter")}
                  />
                  <BadgeProgressCard
                    label="Curator"
                    icon="🎵"
                    description="Reach 100 total plays"
                    current={profile.totalPlays}
                    target={100}
                    earned={profile.badges.some((b) => b.badgeType === "curator")}
                  />
                  <BadgeProgressCard
                    label="Tastemaker"
                    icon="👑"
                    description="Reach 500 total plays"
                    current={profile.totalPlays}
                    target={500}
                    earned={profile.badges.some((b) => b.badgeType === "tastemaker")}
                  />
                </div>
              </div>
            )}
          </section>
        )}
      </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">{label}</div>
      <div className="font-serif text-2xl md:text-3xl font-black tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[var(--color-hair-strong)] p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">{label}</div>
      <div className="font-serif text-2xl font-black tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function BadgeProgressCard({
  label,
  icon,
  description,
  current,
  target,
  earned,
}: {
  label: string;
  icon: string;
  description: string;
  current: number;
  target: number;
  earned: boolean;
}) {
  const pct = Math.min(100, (current / target) * 100);

  return (
    <div className={cn(
      "border p-4",
      earned ? "border-[var(--color-rust)]" : "border-[var(--color-hair-strong)]",
    )}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <div className="font-serif text-base font-medium">{label}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            {description}
          </div>
        </div>
        {earned && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)]">
            Earned ✓
          </span>
        )}
      </div>
      <div className="h-2 bg-[var(--color-hair)] rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            earned ? "bg-[var(--color-rust)]" : "bg-[var(--color-ink-2)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="font-mono text-[10px] text-[var(--color-ink-2)] mt-1">
        {earned
          ? `Awarded at ${target}`
          : `${current.toLocaleString()} / ${target.toLocaleString()} (${Math.floor(pct)}%)`}
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div>
      <div className="border-t border-[var(--color-ink)] pt-8 pb-6 mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="skel h-3 w-40" />
            <div className="skel h-10 w-56" />
            <div className="skel h-4 w-36" />
          </div>
          <div className="flex gap-6 md:gap-10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="text-right space-y-2">
                <div className="skel h-3 w-20 ml-auto" />
                <div className="skel h-8 w-24 ml-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-1 mb-8 border-b border-[var(--color-hair-strong)]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skel h-11 w-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="skel h-6 w-40" />
          <div className="skel h-32 w-full" />
          <div className="skel h-32 w-full" />
        </div>
        <div className="space-y-4">
          <div className="skel h-6 w-32" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skel h-20 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
