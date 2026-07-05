"use client";

// MODULAR: Curator dashboard — a single-page view into a curator's
// ratings history, earnings from curator fees, and their activity
// over time. The page fetches the curator profile + earnings in
// parallel and composes them into a dashboard.
//
// The connected wallet is highlighted at the top if it matches the
// viewed wallet.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { useToast } from "@/components/ui/Toast";
import {
  apiClient,
  type CuratorProfileResponse,
  type EarningsResponse,
} from "@/lib/api-client";
import { parseMoodTags } from "@/lib/format";
import { energyToNumber, tempoToNumber } from "@/lib/snap";
import { cn } from "@/lib/utils";
import { EarningsHistoryTable, ROLE_LABELS } from "@/components/earnings/EarningsHistoryTable";

// ── Types ──────────────────────────────────────────────

interface DashboardData {
  profile: CuratorProfileResponse;
  earnings: EarningsResponse;
}

type DashboardTab = "overview" | "ratings" | "earnings";

// ── Labels ─────────────────────────────────────────────

const ENERGY_LABELS: Record<string, string> = {
  lower: "Lower",
  same: "Same",
  higher: "Higher",
};

const TEMPO_LABELS: Record<string, string> = {
  dragging: "Dragging",
  locked: "Locked",
  rushing: "Rushing",
};

// ── Component ──────────────────────────────────────────

export function CuratorDashboard({ wallet }: { wallet: string }) {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  // Earnings server-side pagination
  const [earningsCache, setEarningsCache] = useState<EarningsResponse | null>(null);
  const [earningsPage, setEarningsPage] = useState(0);
  const EARNINGS_PAGE_SIZE = 10;
  const [filterEarningsRole, setFilterEarningsRole] = useState<string>("");
  const [filterEarningsDateFrom, setFilterEarningsDateFrom] = useState<string>("");
  const [filterEarningsDateTo, setFilterEarningsDateTo] = useState<string>("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrlSyncDone = useRef(false);

  const goToTab = useCallback((tab: DashboardTab) => setActiveTab(tab), []);

  const isOwn = isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const earningsFilterOpts = useCallback((): { role?: string; dateFrom?: string; dateTo?: string } => {
    const opts: { role?: string; dateFrom?: string; dateTo?: string } = {};
    if (filterEarningsRole) opts.role = filterEarningsRole;
    if (filterEarningsDateFrom) opts.dateFrom = filterEarningsDateFrom;
    if (filterEarningsDateTo) opts.dateTo = filterEarningsDateTo;
    return opts;
  }, [filterEarningsRole, filterEarningsDateFrom, filterEarningsDateTo]);

  const refresh = useCallback(async (initialPage?: number, filters?: { role?: string; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    try {
      const page = initialPage ?? 0;
      const offset = page * EARNINGS_PAGE_SIZE;
      const [profile, earnings] = await Promise.all([
        apiClient.getCuratorProfile(wallet),
        apiClient.getArtistEarnings(wallet, { limit: EARNINGS_PAGE_SIZE, offset, ...(filters ?? earningsFilterOpts()) }),
      ]);
      setData({ profile, earnings });
      setEarningsCache(earnings);
      setEarningsPage(page);
    } catch (err) {
      showToast(`Dashboard load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [wallet, showToast]);

  // Fetch a specific page of earnings
  const fetchEarningsPage = useCallback(async (targetPage: number) => {
    try {
      const offset = targetPage * EARNINGS_PAGE_SIZE;
      const earnings = await apiClient.getArtistEarnings(wallet, { limit: EARNINGS_PAGE_SIZE, offset, ...earningsFilterOpts() });
      setEarningsCache((prev) =>
        prev
          ? {
              ...prev,
              recent: earnings.recent,
              recent_total: earnings.recent_total ?? prev.recent_total,
            }
          : earnings,
      );
      setEarningsPage(targetPage);
    } catch (err) {
      showToast(`Failed to load earnings page: ${(err as Error).message}`, "error");
    }
  }, [wallet, showToast, earningsFilterOpts]);

  // Initial load — read page, tab, and filter params from URL
  useEffect(() => {
    if (initialUrlSyncDone.current) return;
    const urlPage = searchParams.get("page");
    const initialPage = urlPage ? Math.max(0, parseInt(urlPage, 10) || 0) : 0;
    const urlTab = searchParams.get("tab");

    const urlRole = searchParams.get("role");
    const urlDateFrom = searchParams.get("dateFrom");
    const urlDateTo = searchParams.get("dateTo");
    const filters: { role?: string; dateFrom?: string; dateTo?: string } = {};
    if (urlRole === "curator" || urlRole === "platform" || urlRole === "musicbrainz") {
      filters.role = urlRole;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterEarningsRole(urlRole);
    }
    if (urlDateFrom) {
      filters.dateFrom = urlDateFrom;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterEarningsDateFrom(urlDateFrom);
    }
    if (urlDateTo) {
      filters.dateTo = urlDateTo;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterEarningsDateTo(urlDateTo);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(initialPage, Object.keys(filters).length > 0 ? filters : undefined);

    if (urlTab && ["overview", "ratings", "earnings"].includes(urlTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(urlTab as DashboardTab);
    }

    initialUrlSyncDone.current = true;
  }, [refresh, searchParams]);

  // Re-fetch page 0 when earnings filters change
  useEffect(() => {
    if (!initialUrlSyncDone.current) return;
    if (activeTab !== "earnings") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchEarningsPage(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEarningsRole, filterEarningsDateFrom, filterEarningsDateTo]);

  // Reset earnings filters when switching away from the earnings tab
  useEffect(() => {
    if (!initialUrlSyncDone.current) return;
    if (activeTab !== "earnings") {
      setFilterEarningsRole("");
      setFilterEarningsDateFrom("");
      setFilterEarningsDateTo("");
    }
  }, [activeTab]);

  // Sync URL with active tab, earnings page, and filters
  useEffect(() => {
    if (!initialUrlSyncDone.current) return;
    const params = new URLSearchParams();
    params.set("tab", activeTab);
    if (activeTab === "earnings") {
      params.set("page", String(earningsPage));
      if (filterEarningsRole) params.set("role", filterEarningsRole);
      if (filterEarningsDateFrom) params.set("dateFrom", filterEarningsDateFrom);
      if (filterEarningsDateTo) params.set("dateTo", filterEarningsDateTo);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, [earningsPage, activeTab, filterEarningsRole, filterEarningsDateFrom, filterEarningsDateTo, router]);

  // ── Loading state ─────────────────────────────────────
  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="border-t border-b border-[var(--color-hair)] py-10 font-serif text-[var(--color-ink-2)] text-center">
        <strong className="block text-[var(--color-ink)] font-medium mb-1">Could not load curator dashboard.</strong>
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

  const { profile, earnings } = data;

  // ── Tabs ──────────────────────────────────────────────
  const tabs: Array<{ id: DashboardTab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "ratings", label: "Ratings", count: profile.ratings_count },
    { id: "earnings", label: "Earnings" },
  ];

  return (
    <div>
      {/* ── Dashboard header ────────────────────────────── */}
      <header className="border-t border-[var(--color-ink)] pt-8 pb-6 mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-3">
              {isOwn ? "Your Curator Profile" : "Curator Profile"}
            </p>
            <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-2">
              Curator Dashboard
            </h2>
            <code className="font-mono text-[11px] text-[var(--color-ink-2)] bg-[var(--color-paper-2)] px-2 py-1 border border-[var(--color-hair-strong)]">
              {wallet.slice(0, 6)}…{wallet.slice(-4)}
            </code>
          </div>
          <div className="flex gap-6 md:gap-10">
            <StatBlock label="Ratings" value={profile.ratings_count} />
            <StatBlock label="Earned" value={`${profile.total_earned_usdc.toFixed(2)} USDC`} />
            <StatBlock label="Transactions" value={earnings.recent.length} />
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

      {/* ── Tab content ─────────────────────────────────── */}
      {activeTab === "overview" && (
        <OverviewTab profile={profile} earnings={earnings} onViewAllRatings={() => goToTab("ratings")} />
      )}

      {activeTab === "ratings" && (
        <RatingsTab ratings={profile.recent_ratings} />
      )}

      {activeTab === "earnings" && (
        <EarningsTab
          earnings={earningsCache ?? earnings}
          onFetchPage={fetchEarningsPage}
          page={earningsPage}
          pageSize={EARNINGS_PAGE_SIZE}
          filterRole={filterEarningsRole}
          filterDateFrom={filterEarningsDateFrom}
          filterDateTo={filterEarningsDateTo}
          onFilterRoleChange={setFilterEarningsRole}
          onFilterDateFromChange={setFilterEarningsDateFrom}
          onFilterDateToChange={setFilterEarningsDateTo}
        />
      )}
    </div>
  );
}

// ── Stat block ─────────────────────────────────────────

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">{label}</div>
      <div className="font-serif text-2xl md:text-3xl font-black tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────

function OverviewTab({
  profile,
  earnings,
  onViewAllRatings,
}: {
  profile: CuratorProfileResponse;
  earnings: EarningsResponse;
  onViewAllRatings?: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Recent ratings */}
      <section>
        <h3 className="font-serif text-xl font-black tracking-tight mb-4">Recent ratings</h3>
        {profile.recent_ratings.length === 0 ? (
          <div className="py-8 px-5 border border-[var(--color-hair)] font-serif text-[var(--color-ink-2)]">
            <p className="italic text-[var(--color-ink-3)] mb-2">
              No ratings yet.
            </p>
            <p className="text-sm leading-snug">
              Claim a submission from the queue, listen across the
              four taste-graph dimensions, and release it for the next
              curator. Three ratings clear the publish gate.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {profile.recent_ratings.slice(0, 6).map((r) => (
              <li
                key={r.id}
                className="py-4 border-t border-[var(--color-hair)] last:border-b"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0">
                    <TasteGraphMini
                      values={{
                        solo: r.soloIntensity,
                        vocal: r.vocalQuality,
                        energy: energyToNumber(r.energyVsStudio),
                        tempo: tempoToNumber(r.tempoFeel),
                      }}
                      size={72}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-base font-medium">
                      {r.title ?? r.submissionId.slice(0, 8)}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                      {r.artist_name ?? "unknown artist"}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--color-ink-2)] mt-1">
                      Solo {r.soloIntensity}/10 · Vocal {r.vocalQuality}/10 ·{" "}
                      {ENERGY_LABELS[r.energyVsStudio] ?? r.energyVsStudio} ·{" "}
                      {TEMPO_LABELS[r.tempoFeel] ?? r.tempoFeel}
                    </div>
                    {r.notes && (
                      <p className="font-serif text-sm text-[var(--color-ink-2)] mt-2 leading-snug">
                        {r.notes}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {profile.recent_ratings.length > 6 && (
          <button
            type="button"
            onClick={() => onViewAllRatings?.()}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mt-2 hover:underline"
          >
            View all {profile.ratings_count} ratings →
          </button>
        )}
      </section>

      {/* Recent earnings */}
      <section>
        <h3 className="font-serif text-xl font-black tracking-tight mb-4">Recent earnings</h3>
        {earnings.recent.length === 0 ? (
          <div className="py-8 px-5 border border-[var(--color-hair)] font-serif text-[var(--color-ink-2)]">
            <p className="italic text-[var(--color-ink-3)] mb-2">
              No curator earnings yet.
            </p>
            <p className="text-sm leading-snug">
              Curator fees share 70% of each submission pool. Rate
              three submissions on the same take and your share lands
              here once it publishes.
            </p>            </div>
        ) : (
          <ul className="flex flex-col">
            {earnings.recent.slice(0, 8).map((e) => (
              <li
                key={`${e.submission_id}-${e.settled_at}`}
                className="py-3 border-t border-[var(--color-hair)] last:border-b"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-[var(--color-ink)] truncate">
                      {e.submission_title ?? e.submission_id.slice(0, 8)}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                      {ROLE_LABELS[e.role] ?? e.role}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-medium tabular-nums text-right shrink-0">
                    +{e.amount} USDC
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Curator info */}
      <section className="lg:col-span-2 border-t border-[var(--color-ink)] pt-6">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">Claim & review</div>
            <div className="font-serif text-lg font-medium leading-snug">
              Claim a submission from the queue, rate it across the four taste-graph dimensions, then release it for the next curator.
            </div>
          </div>
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">Publish gate</div>
            <div className="font-serif text-lg font-medium leading-snug">
              After three curator ratings, the submission publishes automatically and curator fees settle on Arc.
            </div>
          </div>
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">Fee split</div>
            <div className="font-serif text-lg font-medium leading-snug">
              70% of each 0.50 USDC fee goes to the curator pool — shared among all curators who rated.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Ratings Tab ────────────────────────────────────────

function RatingsTab({
  ratings,
}: {
  ratings: CuratorProfileResponse["recent_ratings"];
}) {
  return (
    <section>
      {ratings.length === 0 ? (
        <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border border-[var(--color-hair)]">
          No ratings yet. Claim and rate a submission from the queue.
        </p>
      ) : (
        <ul className="flex flex-col">
          {ratings.map((r) => {
            // MODULAR: parseMoodTags (lib/format) handles BOTH wire shapes the
            // api-client envelope can land as -- a JSON-stringified string OR a
            // Drizzle jsonb round-tripped JS array. The previous inline
            // Array.isArray short-circuit returned [] for the string-shape
            // branch, so the curator's per-row mood tag chips silently
            // disappeared even when the rating row carried typed tags. Routed
            // through the helper via the shared parser used by FeedView/
            // DiscoverView/ArtistDashboard/AgentMonitor.
            const moodTags = parseMoodTags(r.moodTags);
            return (
              <li
                key={r.id}
                className="py-5 border-t border-[var(--color-hair)] last:border-b"
              >
                <div className="flex flex-wrap items-start gap-4">
                  <div className="shrink-0">
                    <TasteGraphMini
                      values={{
                        solo: r.soloIntensity,
                        vocal: r.vocalQuality,
                        energy: energyToNumber(r.energyVsStudio),
                        tempo: tempoToNumber(r.tempoFeel),
                      }}
                      size={96}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-xl font-medium">
                      {r.title ?? "Untitled"}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                      {r.artist_name ?? "unknown artist"} ·{" "}
                      {new Date(r.submittedAt).toLocaleDateString()}
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <ScoreChip label="Solo" value={`${r.soloIntensity}/10`} />
                      <ScoreChip label="Vocal" value={`${r.vocalQuality}/10`} />
                      <ScoreChip label="Energy" value={ENERGY_LABELS[r.energyVsStudio] ?? r.energyVsStudio} />
                      <ScoreChip label="Tempo" value={TEMPO_LABELS[r.tempoFeel] ?? r.tempoFeel} />
                    </div>
                    {moodTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {moodTags.map((tag) => (
                          <span
                            key={tag}
                            className="font-mono text-[10px] uppercase tracking-[0.1em] border border-[var(--color-hair-strong)] px-2 py-0.5 text-[var(--color-ink-2)]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.notes && (
                      <p className="font-serif text-sm text-[var(--color-ink-2)] mt-3 leading-snug border-t border-[var(--color-hair)] pt-3">
                        {r.notes}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ScoreChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--color-hair-strong)] px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{label}</div>
      <div className="font-mono text-sm font-medium tabular-nums text-[var(--color-ink)]">{value}</div>
    </div>
  );
}

// ── Earnings Tab ───────────────────────────────────────

function EarningsTab({
  earnings,
  onFetchPage,
  page,
  pageSize,
  filterRole,
  filterDateFrom,
  filterDateTo,
  onFilterRoleChange,
  onFilterDateFromChange,
  onFilterDateToChange,
}: {
  earnings: EarningsResponse;
  onFetchPage: (page: number) => void;
  page: number;
  pageSize: number;
  filterRole: string;
  filterDateFrom: string;
  filterDateTo: string;
  onFilterRoleChange: (v: string) => void;
  onFilterDateFromChange: (v: string) => void;
  onFilterDateToChange: (v: string) => void;
}) {
  const curatorEarnings = earnings.by_role.filter((r) => r.role === "curator");
  const totalCurator = curatorEarnings.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Summary cards */}
      <section className="lg:col-span-2">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-2">Total curator earnings</div>
            <div className="font-serif text-3xl font-black tabular-nums">{totalCurator.toFixed(2)}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">USDC</div>
          </div>
          {curatorEarnings.map((r) => (
            <div key={r.role} className="border border-[var(--color-hair-strong)] p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-2">
                {ROLE_LABELS[r.role] ?? r.role}
              </div>
              <div className="font-serif text-2xl font-black tabular-nums">{r.total.toFixed(2)}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">
                {r.leg_count} payment{r.leg_count !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent transactions — shared component */}
      <EarningsHistoryTable
        earnings={earnings}
        onFetchPage={onFetchPage}
        page={page}
        pageSize={pageSize}
        filterRole={filterRole}
        filterDateFrom={filterDateFrom}
        filterDateTo={filterDateTo}
        onFilterRoleChange={onFilterRoleChange}
        onFilterDateFromChange={onFilterDateFromChange}
        onFilterDateToChange={onFilterDateToChange}
        emptyMessage="No curator earnings yet."
      />
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
            <div className="skel h-3 w-32" />
            <div className="skel h-10 w-64" />
            <div className="skel h-4 w-40" />
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
          <div key={i} className="skel h-11 w-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="skel h-6 w-40" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="py-4 border-t border-[var(--color-hair)] space-y-2">
              <div className="skel h-5 w-full max-w-[300px]" />
              <div className="skel h-3 w-48" />
              <div className="skel h-3 w-36" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="skel h-6 w-40" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="py-3 border-t border-[var(--color-hair)] space-y-2">
              <div className="skel h-4 w-full max-w-[240px]" />
              <div className="skel h-3 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
