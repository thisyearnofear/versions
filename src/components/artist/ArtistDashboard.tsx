"use client";

// MODULAR: Artist dashboard — a single-page view into an artist's
// earnings, published versions, and placement briefs. The page
// fetches profile + earnings + versions in parallel and composes
// them into a branded dashboard.
//
// The connected wallet is shown at the top; if the viewed wallet
// matches the connected wallet the user sees "Your Dashboard".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { useToast } from "@/components/ui/Toast";
import {
  apiClient,
  type ArtistProfileResponse,
  type ArtistVersionsResponse,
  type EarningsResponse,
  type BriefResponse,
  type AgentReviewRecord,
} from "@/lib/api-client";
import { energyToNumber, tempoToNumber, valenceToNumber } from "@/lib/snap";
import { deriveValence } from "@/services/taste-graph";
import { cn } from "@/lib/utils";
import { EarningsHistoryTable, ROLE_LABELS } from "@/components/earnings/EarningsHistoryTable";
import { TipButton } from "@/components/wallet/TipButton";

// ── Types ──────────────────────────────────────────────

interface DashboardData {
  profile: ArtistProfileResponse;
  versions: ArtistVersionsResponse;
  earnings: EarningsResponse;
}

type DashboardTab = "overview" | "versions" | "earnings" | "placements";

// MODULAR: each `published_versions` row shape from the API.
// Omit + explicit NonNullable<published> guarantees `published`
// is REQUIRED on this row type, so the `PublishedRowRadar` block
// can read `published.aggregated_mood_tags` without the optional
// chain or a runtime null check at every call site. The filter
// in ArtistDashboard().publishedVersions keeps the guard at the
// row source instead.
type PublishedData = NonNullable<ArtistVersionsResponse["rows"][number]["published"]>;
type PublishedVersionRow = Omit<ArtistVersionsResponse["rows"][number], "published"> & {
  published: PublishedData;
};

// MODULAR: per-row 5-axis radar block. The hook lives INSIDE this
// component, so each .map() call site simply does
// `<PublishedRowRadar published={v.published} />` -- React Hooks
// is satisfied because the hook has a single, stable call site
// per concrete subcomponent instance. The pre-narrowed PublishedData
// prop means the aggregated_mood_tags default-to-[] coercion is
// the only spot that has to defend against a missing field.
function PublishedRowRadar({
  published,
  size = 80,
}: {
  published: PublishedData;
  size?: number;
}) {
  const tags = published.aggregated_mood_tags;
  const valence = useMemo(() => deriveValence(tags ?? []), [tags]);
  return (
    <TasteGraphMini
      values={{
        solo: published.avg_solo_intensity ?? 0,
        vocal: published.avg_vocal_quality ?? 0,
        energy: energyToNumber(published.energy_consensus),
        tempo: tempoToNumber(published.tempo_consensus),
        valence: valenceToNumber(valence ?? "neutral"),
      }}
      size={size}
    />
  );
}

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

const AGENT_META: Record<string, { icon: string; name: string }> = {
  production: { icon: "🎛️", name: "Production Agent" },
  performance: { icon: "🎤", name: "Performance Agent" },
  market: { icon: "📊", name: "Market Agent" },
};

// ── Component ──────────────────────────────────────────

export function ArtistDashboard({ wallet }: { wallet: string }) {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [expandedBrief, setExpandedBrief] = useState<string | null>(null);
  const [briefCache, setBriefCache] = useState<Record<string, BriefResponse | null>>({});
  const [reviewCache, setReviewCache] = useState<Record<string, AgentReviewRecord[]>>({});
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

  const isOwn = isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const earningsFilterOpts = useCallback((): { role?: string; dateFrom?: string; dateTo?: string } => {
    const opts: { role?: string; dateFrom?: string; dateTo?: string } = {};
    if (filterEarningsRole) opts.role = filterEarningsRole;
    if (filterEarningsDateFrom) opts.dateFrom = filterEarningsDateFrom;
    if (filterEarningsDateTo) opts.dateTo = filterEarningsDateTo;
    return opts;
  }, [filterEarningsRole, filterEarningsDateFrom, filterEarningsDateTo]);

  // Fetch all data
  const refresh = useCallback(async (initialPage?: number, filters?: { role?: string; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    try {
      const page = initialPage ?? 0;
      const offset = page * EARNINGS_PAGE_SIZE;
      const [profile, versions, earnings] = await Promise.all([
        apiClient.getArtistProfile(wallet),
        apiClient.getArtistVersions(wallet, 50),
        apiClient.getArtistEarnings(wallet, { limit: EARNINGS_PAGE_SIZE, offset, ...(filters ?? earningsFilterOpts()) }),
      ]);
      setData({ profile, versions, earnings });
      setEarningsCache(earnings);
      setEarningsPage(page);
    } catch (err) {
      showToast(`Dashboard load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [wallet, showToast, earningsFilterOpts]);

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

  // Initial load — read page and tab from URL to avoid double-fetch
  useEffect(() => {
    if (initialUrlSyncDone.current) return;
    const urlPage = searchParams.get("page");
    const initialPage = urlPage ? Math.max(0, parseInt(urlPage, 10) || 0) : 0;
    const urlTab = searchParams.get("tab");

    // Read filter params from URL and pass directly to refresh
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

    if (urlTab && ["overview", "versions", "earnings", "placements"].includes(urlTab)) {
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

  // Sync URL with active tab and earnings page + filters
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

  // Fetch brief + reviews for a published version
  const loadBrief = useCallback(
    async (submissionId: string) => {
      if (briefCache[submissionId] !== undefined) return;
      try {
        const brief = await apiClient.getBrief(submissionId);
        setBriefCache((prev) => ({ ...prev, [submissionId]: brief }));
      } catch {
        setBriefCache((prev) => ({ ...prev, [submissionId]: null }));
      }
      try {
        const reviews = await apiClient.getReviews(submissionId);
        setReviewCache((prev) => ({ ...prev, [submissionId]: reviews }));
      } catch {
        /* skip */
      }
    },
    [briefCache],
  );

  const toggleBrief = useCallback(
    (submissionId: string) => {
      if (expandedBrief === submissionId) {
        setExpandedBrief(null);
      } else {
        setExpandedBrief(submissionId);
        void loadBrief(submissionId);
      }
    },
    [expandedBrief, loadBrief],
  );

  // Derived stats
  const totalEarned = data?.earnings.total ?? 0;
  const publishedCount = data?.profile.published_count ?? 0;
  const submissionCount = data?.profile.submissions_count ?? 0;

  // ── Loading state ─────────────────────────────────────
  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="border-t border-b border-[var(--color-hair)] py-10 font-serif text-[var(--color-ink-2)] text-center">
        <strong className="block text-[var(--color-ink)] font-medium mb-1">Could not load dashboard.</strong>
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

  const publishedVersions = data.versions.rows.filter((v): v is PublishedVersionRow =>
    v.status === "published" && v.published != null
  );

  // ── Tabs ──────────────────────────────────────────────
  const tabs: Array<{ id: DashboardTab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "versions", label: "Versions", count: publishedCount },
    { id: "earnings", label: "Earnings" },
    { id: "placements", label: "Placements" },
  ];

  return (
    <div>
      {/* ── Dashboard header ────────────────────────────── */}
      <header className="border-t border-[var(--color-ink)] pt-8 pb-6 mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-3">
              {isOwn ? "Your Dashboard" : "Artist Dashboard"}
            </p>
            <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-2">
              {data.profile.recent_published[0]?.artistName ?? data.profile.recent_submissions[0]?.artistName ?? "Artist"}
            </h2>
            <code className="font-mono text-[11px] text-[var(--color-ink-2)] bg-[var(--color-paper-2)] px-2 py-1 border border-[var(--color-hair-strong)]">
              {wallet.slice(0, 6)}…{wallet.slice(-4)}
            </code>
            {/* MODULAR: sub-cent USDC nanopayment tip surface (x402 +
                Circle Gateway). Sits next to the wallet address on
                the Overview tab so the artist is one click from
                receiving a lepton-scale tip. */}
            <div className="mt-4 max-w-[360px]">
              <TipButton
                artistWallet={wallet}
                artistName={data.profile.recent_published[0]?.artistName ?? data.profile.recent_submissions[0]?.artistName}
              />
            </div>
          </div>
          <div className="flex gap-6 md:gap-10">
            <StatBlock label="Submissions" value={submissionCount} />
            <StatBlock label="Published" value={publishedCount} />
            <StatBlock label="Earned" value={`${totalEarned.toFixed(2)} USDC`} />
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
        <OverviewTab
          versions={publishedVersions}
          earnings={data.earnings}
        />
      )}

      {activeTab === "versions" && (
        <VersionsTab
          versions={data.versions.rows}
        />
      )}

      {activeTab === "earnings" && (
        <EarningsTab
          earnings={earningsCache ?? data.earnings}
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

      {activeTab === "placements" && (
        <PlacementsTab
          published={publishedVersions}
          briefCache={briefCache}
          reviewCache={reviewCache}
          expandedBrief={expandedBrief}
          onToggleBrief={toggleBrief}
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
  versions,
  earnings,
}: {
  versions: PublishedVersionRow[];
  earnings: EarningsResponse;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Recent published versions */}
      <section>
        <h3 className="font-serif text-xl font-black tracking-tight mb-4">Recent published</h3>
        {versions.length === 0 ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-8 text-center border border-[var(--color-hair)]">
            No published versions yet.
          </p>
        ) : (
          <ul className="flex flex-col">
            {versions.slice(0, 5).map((v) => {
              const edition = v.id.replace(/-/g, "").slice(0, 4).toUpperCase();
              const valence = deriveValence(v.published.aggregated_mood_tags ?? []);
              return (
                <li
                  key={v.id}
                  className="py-4 border-t border-[var(--color-hair)] last:border-b"
                >
                  <div className="font-serif text-base font-medium">{v.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                    Edition {edition} · {v.versionType} · solo{" "}
                    {(v.published.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
                    {(v.published.avg_vocal_quality ?? 0).toFixed(1)} ·{" "}
                    {v.published.energy_consensus ?? "-"} · {v.published.tempo_consensus ?? "-"} ·{" "}
                    {valence ?? "-"} · {v.ratingCount} ratings
                  </div>
                  <div className="flex gap-3 mt-2">
                    <PublishedRowRadar published={v.published} size={80} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent earnings */}
      <section>
        <h3 className="font-serif text-xl font-black tracking-tight mb-4">Recent earnings</h3>
        {earnings.recent.length === 0 ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-8 text-center border border-[var(--color-hair)]">
            No earnings yet. Submit a version to start earning.
          </p>
        ) : (
          <ul className="flex flex-col">
            {earnings.recent.slice(0, 8).map((e) => (
              <li
                key={`${e.submission_id}-${e.role}-${e.settled_at}`}
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

      {/* Fee split info */}
      <section className="lg:col-span-2 border-t border-[var(--color-ink)] pt-6">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">Curator pool</div>
            <div className="font-serif text-2xl font-black">70%</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">
              of each submission fee goes to curators
            </div>
          </div>
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">Platform</div>
            <div className="font-serif text-2xl font-black">20%</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">
              platform operating share
            </div>
          </div>
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">Attribution</div>
            <div className="font-serif text-2xl font-black">10%</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">
              MusicBrainz attribution share
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Versions Tab ───────────────────────────────────────

function VersionsTab({
  versions,
}: {
  versions: ArtistVersionsResponse["rows"];
}) {
  const statusColors: Record<string, string> = {
    published: "text-[var(--color-rust)]",
    in_curation: "text-[var(--color-ink-2)]",
    awaiting_curation: "text-[var(--color-ink-3)]",
    pending_payment: "text-[var(--color-ink-3)]",
    rejected: "text-[var(--color-ink-2)]",
  };

  const statusLabels: Record<string, string> = {
    published: "Published",
    in_curation: "In curation",
    awaiting_curation: "Awaiting curation",
    pending_payment: "Pending payment",
    rejected: "Rejected",
  };

  return (
    <section>
      {versions.length === 0 ? (
        <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border border-[var(--color-hair)]">
          No submissions found for this wallet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {versions.map((v) => {
            const edition = v.id?.replace(/-/g, "").slice(0, 4).toUpperCase() ?? "----";
            const audioUrl = `/api/v1/uploads/${v.audioPath?.split("/").pop() ?? ""}`;
            const statusClass = statusColors[v.status] ?? "text-[var(--color-ink-2)]";
            const valence = v.published
              ? deriveValence(v.published.aggregated_mood_tags ?? [])
              : null;
            return (
              <li
                key={v.id}
                className="py-5 border-t border-[var(--color-hair)] last:border-b"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-xl font-medium">{v.title}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                      Edition {edition} · {v.versionType} · {v.genre ?? "no genre"}
                    </div>
                    {v.published && (
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                        solo {(v.published.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
                        {(v.published.avg_vocal_quality ?? 0).toFixed(1)} ·{" "}
                        {v.published.energy_consensus ?? "-"} · {v.published.tempo_consensus ?? "-"} ·{" "}
                        {valence ?? "-"}
                      </div>
                    )}
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] mt-2">
                      <span className={statusClass}>{statusLabels[v.status] ?? v.status}</span>
                      {v.ratingCount != null && (
                        <span className="text-[var(--color-ink-3)] ml-3">{v.ratingCount} rating{v.ratingCount !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    <div className="mt-3">
                      <AudioPlayer src={audioUrl} title={v.title} by={v.artistName} />
                    </div>
                  </div>
                  {v.published && (
                    <div className="shrink-0">
                      <PublishedRowRadar published={v.published} size={80} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  const total = earnings.total;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Summary cards */}
      <section className="lg:col-span-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="border border-[var(--color-hair-strong)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-2">Total earned</div>
            <div className="font-serif text-3xl font-black tabular-nums">{total.toFixed(2)}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">USDC</div>
          </div>
          {earnings.by_role.map((r) => (
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
      />
    </div>
  );
}

// ── Placements Tab ─────────────────────────────────────

function PlacementsTab({
  published,
  briefCache,
  reviewCache,
  expandedBrief,
  onToggleBrief,
}: {
  published: PublishedVersionRow[];
  briefCache: Record<string, BriefResponse | null>;
  reviewCache: Record<string, AgentReviewRecord[]>;
  expandedBrief: string | null;
  onToggleBrief: (id: string) => void;
}) {
  if (published.length === 0) {
    return (
      <section>
        <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border border-[var(--color-hair)]">
          No published versions yet. Once a version is published, the Market agent generates a placement brief.
        </p>
      </section>
    );
  }

  return (
    <section>
      <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug max-w-2xl mb-8">
        The Market agent generates a placement brief for each published version — venues, YouTube channels,
        influencers, and draft emails to help you get your music in front of the right people.
      </p>
      <ul className="flex flex-col">
        {published.map((v) => {
          const brief = briefCache[v.id];
          const reviews = reviewCache[v.id] ?? [];
          const isExpanded = expandedBrief === v.id;
          const loading = isExpanded && brief === undefined;
          // MODULAR: placements row valence is derived client-side
          // from the same aggregated_mood_tags polarises the radar.
          // Inline call -- no hook, deriveValence is pure (~10 tag
          // comparisons). The radar sub-component memoizes its own
          // copy for the visual.
          const valence = deriveValence(v.published.aggregated_mood_tags ?? []);

          return (
            <li
              key={v.id}
              className="border-t border-[var(--color-hair)] last:border-b"
            >
              <button
                type="button"
                onClick={() => onToggleBrief(v.id)}
                className="w-full text-left py-4 flex items-center justify-between gap-4 hover:bg-[var(--color-paper-2)]/40 transition-colors px-3 -mx-3"
              >
                <div className="min-w-0">
                  <div className="font-serif text-base font-medium">{v.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                    {v.versionType} · {valence ?? "-"} · {v.ratingCount} ratings
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {brief === null && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                      No brief
                    </span>
                  )}
                  {brief && !isExpanded && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-rust)]">
                      {brief.venues.length} venues · {brief.draftEmails.length} drafts
                    </span>
                  )}
                  <span className={cn(
                    "font-mono text-sm transition-transform",
                    isExpanded && "rotate-90",
                  )}>
                    →
                  </span>
                </div>
              </button>

              {/* MODULAR: 5-axis radar strip sits just below the
                  click-to-expand button so the artist can scan the
                  taste signal at a glance before deciding to open
                  the brief. size=60 keeps it slim -- this is a
                  contextual reminder, not the full Overview/Versions
                  treatment. */}
              <div className="px-3 py-2 flex items-center gap-3 border-b border-[var(--color-hair)]">
                <PublishedRowRadar published={v.published} size={60} />
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
                  solo {(v.published.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
                  {(v.published.avg_vocal_quality ?? 0).toFixed(1)} · {valence ?? "-"}
                </div>
              </div>

              {isExpanded && loading && (
                <div className="px-3 pb-4">
                  <div className="border border-[var(--color-hair-strong)] p-5">
                    <div className="skel h-4 w-40 mb-3" />
                    <div className="skel h-3 w-full max-w-[300px] mb-2" />
                    <div className="skel h-3 w-[200px]" />
                  </div>
                </div>
              )}

              {isExpanded && brief && (
                <div className="px-3 pb-6 space-y-6">
                  {/* Audience summary */}
                  <div className="border border-[var(--color-hair-strong)] p-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-2">
                      Audience summary
                    </div>
                    <p className="font-serif text-base leading-snug text-[var(--color-ink)]">
                      {brief.audienceSummary}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    {/* Venues */}
                    <div className="border border-[var(--color-hair-strong)] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-3">
                        Venues ({brief.venues.length})
                      </div>
                      {brief.venues.length === 0 ? (
                        <p className="font-mono text-[10px] text-[var(--color-ink-3)] italic">None listed</p>
                      ) : (
                        <ul className="space-y-3">
                          {brief.venues.map((v, i) => (
                            <li key={i}>
                              <div className="font-serif text-sm font-medium">{v.name}</div>
                              <div className="font-mono text-[10px] text-[var(--color-ink-2)] mt-0.5">{v.reason}</div>
                              {v.contact && (
                                <div className="font-mono text-[10px] text-[var(--color-rust)] mt-0.5">{v.contact}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* YouTube channels */}
                    <div className="border border-[var(--color-hair-strong)] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-3">
                        YouTube ({brief.youtubeChannels.length})
                      </div>
                      {brief.youtubeChannels.length === 0 ? (
                        <p className="font-mono text-[10px] text-[var(--color-ink-3)] italic">None listed</p>
                      ) : (
                        <ul className="space-y-3">
                          {brief.youtubeChannels.map((c) => (
                            <li key={c.name}>
                              <div className="font-serif text-sm font-medium">{c.name}</div>
                              <div className="font-mono text-[10px] text-[var(--color-ink-2)] mt-0.5">{c.reason}</div>
                              {c.followers && (
                                <div className="font-mono text-[10px] text-[var(--color-ink-3)] mt-0.5">{c.followers}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Influencers */}
                    <div className="border border-[var(--color-hair-strong)] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-3">
                        Influencers ({brief.influencers.length})
                      </div>
                      {brief.influencers.length === 0 ? (
                        <p className="font-mono text-[10px] text-[var(--color-ink-3)] italic">None listed</p>
                      ) : (
                        <ul className="space-y-3">
                          {brief.influencers.map((inf, i) => (
                            <li key={i}>
                              <div className="font-serif text-sm font-medium">{inf.name}</div>
                              <div className="font-mono text-[10px] text-[var(--color-ink-2)] mt-0.5">{inf.reason}</div>
                              {inf.platform && (
                                <div className="font-mono text-[10px] text-[var(--color-ink-3)] mt-0.5">{inf.platform}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>                    {/* Draft emails */}
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-3">
                      Draft emails ({brief.draftEmails.length})
                    </div>
                    {brief.draftEmails.length === 0 ? (
                      <p className="font-mono text-[10px] text-[var(--color-ink-3)] italic">None drafted</p>
                    ) : (
                      <div className="space-y-4">
                        {brief.draftEmails.map((e) => (
                          <div key={e.to} className="border border-[var(--color-hair-strong)] p-4">
                            <div className="font-mono text-[11px] mb-1">
                              <span className="text-[var(--color-ink-3)]">To:</span>{" "}
                              <span className="text-[var(--color-ink)]">{e.to}</span>
                            </div>
                            <div className="font-mono text-[11px] mb-2">
                              <span className="text-[var(--color-ink-3)]">Subject:</span>{" "}
                              <span className="text-[var(--color-ink)]">{e.subject}</span>
                            </div>
                            <div className="font-serif text-sm text-[var(--color-ink-2)] leading-snug whitespace-pre-wrap border-t border-[var(--color-hair)] pt-3">
                              {e.body}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Agent reviews */}
                  {reviews.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-3">
                        Agent reviews
                      </div>
                      <div className="grid md:grid-cols-3 gap-4">
                        {reviews.map((r) => {
                          const meta = AGENT_META[r.agent_name] ?? { icon: "🤖", name: r.agent_name };
                          return (
                            <div key={r.agent_name} className="border border-[var(--color-hair-strong)] p-4">
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mb-2">
                                {meta.icon} {meta.name}
                              </div>
                              <div className="font-mono text-[10px] text-[var(--color-ink-2)] space-y-1">
                                <div>Solo {r.solo_intensity}/10 · Vocal {r.vocal_quality}/10</div>
                                <div>{ENERGY_LABELS[r.energy_vs_studio] ?? r.energy_vs_studio} · {TEMPO_LABELS[r.tempo_feel] ?? r.tempo_feel}</div>
                              </div>
                              {r.notes && (
                                <p className="font-serif text-sm text-[var(--color-ink-2)] mt-2 leading-snug">{r.notes}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skel h-11 w-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="skel h-6 w-40" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="py-4 border-t border-[var(--color-hair)] space-y-2">
              <div className="skel h-5 w-full max-w-[300px]" />
              <div className="skel h-3 w-56" />
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
