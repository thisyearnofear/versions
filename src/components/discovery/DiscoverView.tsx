"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { useToast } from "@/components/ui/Toast";
import {
  apiClient,
  type BriefSearchResponse,
  type BriefSearchRow,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { matchBriefHash } from "@/lib/match-benchmark";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { LICENSE_FEES, LICENSE_USAGE_TYPES, type LicenseUsageType } from "@/lib/pricing";

const BRIEF_REFINEMENTS = [
  { id: "no-vocals", label: "no vocals", instruction: "no vocals, instrumental" },
  { id: "darker", label: "darker", instruction: "darker mood, less bright" },
  { id: "faster", label: "faster", instruction: "faster tempo" },
  { id: "acoustic", label: "acoustic", instruction: "more acoustic-leaning" },
  { id: "electronic", label: "electronic", instruction: "more electronic-leaning" },
  { id: "raw", label: "lo-fi", instruction: "raw, unpolished feel" },
] as const;

const USAGE_LABELS: Record<LicenseUsageType, string> = {
  sync_ad: "Sync · Ad",
  sync_tv_film: "Sync · TV/Film",
  sync_digital: "Sync · Digital",
  other: "Other",
};

export function DiscoverView() {
  return <MatchSearch />;
}

// ── Agent Trace (animated sequential reveal) ─────────────

function AgentTrace({ searchTimeMs, trackCount }: { searchTimeMs: number | null; trackCount: number }) {
  const [expanded, setExpanded] = useState(false);
  if (searchTimeMs === null) return null;

  const totalSec = (searchTimeMs / 1000).toFixed(1);
  const prodTime = (searchTimeMs * 0.35 / 1000).toFixed(1);
  const perfTime = (searchTimeMs * 0.30 / 1000).toFixed(1);
  const marketTime = (searchTimeMs * 0.35 / 1000).toFixed(1);

  const agents = [
    { label: "Production", time: prodTime, color: "bg-[var(--color-rust)]" },
    { label: "Performance", time: perfTime, color: "bg-[var(--color-ink)]" },
    { label: "Market", time: marketTime, color: "bg-[var(--color-ink-2)]" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-5"
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 text-left group"
      >
        {/* Animated dots showing each agent completed */}
        <div className="flex items-center gap-1">
          {agents.map((a, i) => (
            <motion.span
              key={a.label}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.15, type: "spring", stiffness: 500, damping: 20 }}
              className={cn("w-2 h-2 rounded-full", a.color)}
            />
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {trackCount} tracks · {totalSec}s · Arc
        </span>
        <span className="font-mono text-[9px] text-[var(--color-ink-3)] group-hover:text-[var(--color-rust)] transition-colors">
          {expanded ? "−" : "+"}
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 pl-1 space-y-1.5">
              {agents.map((a, i) => (
                <motion.div
                  key={a.label}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", a.color)} />
                  <span className="text-[var(--color-ink-2)]">{a.label}</span>
                  <span className="text-[var(--color-ink-3)]">{a.time}s</span>
                  <span className="text-[var(--color-rust)]">✓</span>
                </motion.div>
              ))}
              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] pt-1 text-[var(--color-ink-3)]">
                <span className="w-1.5 h-1.5 rounded-full border border-[var(--color-rust)]" />
                ERC-8183 · USDC · finality {"<"}1s
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Match Search ─────────────────────────────────────────

function MatchSearch() {
  const { showToast } = useToast();
  const { isAuthenticated, requireAuth } = useSupervisorAuth();
  const searchParams = useSearchParams();
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BriefSearchResponse | null>(null);
  const [searchTimeMs, setSearchTimeMs] = useState<number | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [refinements, setRefinements] = useState<string[]>([]);
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fromUrl = searchParams.get("brief");
    if (fromUrl) setBrief(fromUrl);
  }, [searchParams]);

  const runSearch = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 500) return;
    setLoading(true);
    setSubmitAttempted(true);
    setSearchTimeMs(null);
    track("brief_search", { len: trimmed.length });
    const t0 = performance.now();
    try {
      const res = await apiClient.searchByBrief({ brief: trimmed, limit: 20 });
      setSearchTimeMs(Math.round(performance.now() - t0));
      setResults(res);
      if (res.rows.length === 0) {
        showToast("No matches — try a broader brief.", "info");
      }
      void apiClient.logSearch({ briefText: trimmed, resultsCount: res.total }).catch(() => {});
    } catch (err) {
      showToast(`Search failed: ${(err as Error).message}`, "error");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (brief.trim().length >= 3 && !submitAttempted && !results) {
      void runSearch(brief);
    }
  }, [brief, runSearch, submitAttempted, results]);

  useEffect(() => {
    if (!isAuthenticated) {
      setShortlistedIds(new Set());
      return;
    }
    void apiClient
      .getInterests({ limit: 100 })
      .then((res) => setShortlistedIds(new Set(res.rows.map((r) => r.submission_id))))
      .catch(() => {});
  }, [isAuthenticated, results?.total]);

  const markShortlisted = useCallback((submissionId: string) => {
    setShortlistedIds((prev) => new Set(prev).add(submissionId));
  }, []);

  const applyRefinement = useCallback(
    (instruction: string) => {
      const next = [...refinements, instruction];
      setRefinements(next);
      void runSearch([brief.trim(), ...next].filter(Boolean).join(" · "));
    },
    [brief, refinements, runSearch],
  );
  const removeRefinement = useCallback(
    (instruction: string) => {
      const next = refinements.filter((r) => r !== instruction);
      setRefinements(next);
      void runSearch([brief.trim(), ...next].filter(Boolean).join(" · "));
    },
    [brief, refinements, runSearch],
  );

  const hasResults = results && results.rows.length > 0 && !loading;

  return (
    <section>
      {/* Search bar — the interface IS the search */}
      <div className="max-w-2xl mb-4">
        <div className="flex items-stretch border border-[var(--color-ink)] bg-[var(--color-paper)] rounded-sm overflow-hidden">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Describe the scene — mood, tempo, energy, instruments..."
            rows={2}
            maxLength={500}
            aria-label="Describe the scene"
            className="flex-1 min-w-0 bg-transparent p-3 font-serif text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none resize-none"
          />
          <button
            type="button"
            onClick={() => void runSearch(brief)}
            disabled={loading || brief.trim().length < 3}
            className="self-end bg-[var(--color-ink)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors disabled:opacity-40"
          >
            {loading ? "..." : "Match"}
          </button>
        </div>
        {/* Example chips — only when no results yet */}
        {!hasResults && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              Try:
            </span>
            {EXAMPLE_BRIEFS.slice(0, 4).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => { setBrief(e.brief); void runSearch(e.brief); }}
                className="border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
              >
                {e.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="py-12" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <motion.span
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="inline-block w-2.5 h-2.5 bg-[var(--color-rust)] rounded-full"
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              3 agents scoring...
            </span>
          </div>
        </div>
      )}

      {hasResults && (
        <div>
          <AgentTrace searchTimeMs={searchTimeMs} trackCount={results.rows.length} />

          {/* Refinement chips — appear after results */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {refinements.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 bg-[var(--color-rust)] text-[var(--color-paper)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide rounded-sm"
              >
                {a}
                <button type="button" onClick={() => removeRefinement(a)} className="opacity-70 hover:opacity-100" aria-label={`Remove: ${a}`}>×</button>
              </span>
            ))}
            {BRIEF_REFINEMENTS.filter((o) => !refinements.includes(o.instruction)).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => applyRefinement(o.instruction)}
                disabled={loading}
                className="border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-3)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-40 rounded-sm"
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Results */}
          <div role="list" aria-label="Match results" className="space-y-2">
            {results.rows.map((r, i) => (
              <motion.div
                key={r.submission_id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.06, 0.4), duration: 0.3 }}
              >
                <MatchRow
                  row={r}
                  rank={i + 1}
                  brief={brief}
                  isShortlisted={shortlistedIds.has(r.submission_id)}
                  onShortlisted={markShortlisted}
                  isAuthenticated={isAuthenticated}
                  requireAuth={requireAuth}
                />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {results && results.rows.length === 0 && !loading && submitAttempted && (
        <p className="py-12 text-center font-serif italic text-[var(--color-ink-3)]">
          No matches. Try a broader brief.
        </p>
      )}
    </section>
  );
}

// ── Result Card ──────────────────────────────────────────
// Visual: cover art + title/artist + fit score (color-coded) + consensus.
// Expands for audio + actions.

function fitScoreColor(score: number): string {
  if (score >= 8) return "text-green-600";
  if (score >= 5) return "text-amber-600";
  if (score >= 3) return "text-orange-500";
  return "text-[var(--color-ink-3)]";
}

function MatchRow({
  row,
  rank,
  brief,
  isShortlisted,
  onShortlisted,
  isAuthenticated,
  requireAuth,
}: {
  row: BriefSearchRow;
  rank: number;
  brief: string;
  isShortlisted: boolean;
  onShortlisted: (submissionId: string) => void;
  isAuthenticated: boolean;
  requireAuth: (returnTo?: string) => boolean;
}) {
  const { showToast } = useToast();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [showLicensePanel, setShowLicensePanel] = useState(false);
  const [usageType, setUsageType] = useState<LicenseUsageType>("sync_tv_film");
  const [licensing, setLicensing] = useState(false);
  const reason = row.why_fits[0] ?? null;

  const returnTo = typeof window !== "undefined"
    ? `${window.location.pathname}${window.location.search}`
    : "/discover";

  const onShortlist = async () => {
    if (!requireAuth(returnTo)) return;
    try {
      await apiClient.addInterest({ submissionId: row.submission_id });
      onShortlisted(row.submission_id);
      showToast("Added to shortlist — view on dashboard", "success", 2500);
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, "error");
    }
  };

  const onRequestLicense = async () => {
    if (!requireAuth(returnTo)) return;
    setLicensing(true);
    try {
      await apiClient.addInterest({ submissionId: row.submission_id }).catch(() => {});
      onShortlisted(row.submission_id);
      await apiClient.createLicense({
        submissionId: row.submission_id,
        briefHash: matchBriefHash(brief),
        briefText: brief,
        usageType,
      });
      showToast("License ready — settle on dashboard", "success", 3000);
      setShowLicensePanel(false);
      router.push("/supervisor#licenses");
    } catch (err) {
      showToast(`License failed: ${(err as Error).message}`, "error");
    } finally {
      setLicensing(false);
    }
  };

  const onLicenseClick = () => {
    if (!requireAuth(returnTo)) return;
    setShowLicensePanel((p) => !p);
  };

  return (
    <article
      role="listitem"
      className={cn(
        "border border-[var(--color-hair)] rounded-sm transition-all duration-200 hover:border-[var(--color-ink-3)] hover:shadow-sm",
        expanded && "border-[var(--color-ink)] shadow-sm",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((p) => !p)}
        className="group w-full p-3 text-left"
      >
        <div className="flex items-center gap-3">
          {/* Cover art or rank indicator */}
          {row.cover_svg ? (
            <div
              className="w-10 h-10 shrink-0 rounded-sm overflow-hidden bg-[var(--color-paper-2)]"
              dangerouslySetInnerHTML={{ __html: row.cover_svg }}
            />
          ) : (
            <div className="w-10 h-10 shrink-0 rounded-sm bg-[var(--color-paper-2)] grid place-items-center">
              <span className="font-mono text-[11px] font-bold text-[var(--color-ink-3)]">{rank}</span>
            </div>
          )}

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-[15px] font-semibold truncate">{row.title}</span>
              <span className="font-serif text-[13px] text-[var(--color-ink-2)] truncate">{row.artist_name}</span>
            </div>
            {reason && (
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--color-ink-3)] truncate mt-0.5">
                {reason}
              </p>
            )}
          </div>

          {/* Fit score — color coded */}
          <span className={cn("font-mono text-[13px] font-bold tabular-nums shrink-0", fitScoreColor(row.fit_score))}>
            {row.fit_score.toFixed(1)}
          </span>

          {/* Consensus badge */}
          <span className="font-mono text-[8px] tabular-nums text-[var(--color-ink-3)] shrink-0 bg-[var(--color-paper-2)] px-1.5 py-0.5 rounded-sm">
            {row.rating_count}/3
          </span>

          {/* Expand indicator */}
          <span className={cn(
            "w-6 h-6 grid place-items-center rounded-full transition-all duration-200 shrink-0",
            expanded
              ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
              : "bg-[var(--color-paper-2)] text-[var(--color-ink-3)] group-hover:bg-[var(--color-rust)] group-hover:text-[var(--color-paper)]",
          )}>
            <span className="text-[10px]">{expanded ? "−" : "▶"}</span>
          </span>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-[var(--color-hair)]">
              <AudioPlayer
                src={`/api/v1/uploads/${row.audio_path?.split("/").pop() ?? ""}`}
                title={row.title}
                by={row.artist_name}
              />
              {row.why_fits.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {row.why_fits.slice(1).map((w, j) => (
                    <span key={j} className="bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-ink-2)] rounded-sm">
                      {w}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => void onShortlist()}
                  disabled={isShortlisted}
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-sm transition-colors",
                    isShortlisted
                      ? "bg-[var(--color-rust)] text-[var(--color-paper)] opacity-80"
                      : isAuthenticated
                        ? "bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-rust)]"
                        : "border border-[var(--color-ink-3)] text-[var(--color-ink-3)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                  )}
                >
                  {isShortlisted ? "✓ Shortlisted" : isAuthenticated ? "Shortlist" : "Sign in to shortlist"}
                </button>
                <button
                  type="button"
                  onClick={onLicenseClick}
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.12em] border px-3 py-1.5 rounded-sm transition-colors",
                    showLicensePanel
                      ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                      : isAuthenticated
                        ? "border-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
                        : "border-[var(--color-ink-3)] text-[var(--color-ink-3)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                  )}
                >
                  {isAuthenticated ? "License" : "Sign in to license"}
                </button>
                {isAuthenticated && (
                  <Link
                    href="/supervisor"
                    className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] px-1 py-1.5 transition-colors"
                  >
                    Dashboard →
                  </Link>
                )}
              </div>

              <AnimatePresence>
                {showLicensePanel && isAuthenticated && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pt-3 border-t border-[var(--color-hair)]">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-2">
                        Usage type · fee on Arc USDC
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {LICENSE_USAGE_TYPES.filter((t) => t !== "other").map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setUsageType(t)}
                            className={cn(
                              "font-mono text-[9px] uppercase tracking-wide px-2.5 py-1 rounded-sm border transition-colors",
                              usageType === t
                                ? "bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]"
                                : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)]",
                            )}
                          >
                            {USAGE_LABELS[t]} · ${LICENSE_FEES[t]}
                          </button>
                        ))}
                      </div>
                      <p className="font-mono text-[9px] text-[var(--color-ink-3)] mb-3">
                        Worldwide · 12 months · settle on dashboard after request
                      </p>
                      <button
                        type="button"
                        onClick={() => void onRequestLicense()}
                        disabled={licensing}
                        className="bg-[var(--color-rust)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2 rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {licensing ? "Creating…" : `Request license · $${LICENSE_FEES[usageType]} USDC`}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
