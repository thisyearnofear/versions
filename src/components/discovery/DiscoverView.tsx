"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useChainId, useSignTypedData } from "wagmi";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { useToast } from "@/components/ui/Toast";
import {
  apiClient,
  type BriefSearchResponse,
  type BriefSearchRow,
  type LicenseRow,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { matchBriefHash } from "@/lib/match-benchmark";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import type { LicenseUsageType } from "@/lib/pricing";
import { searchByBriefPaid, SCORE_FEE_USDC, type ScorePaymentReceipt } from "@/lib/x402-score-client";
import { AgentTrace } from "@/components/discovery/AgentTrace";
import { AgentThinkingPulse, FitScorePop, SuccessCheck } from "@/components/discovery/motion";

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

function MatchSearch() {
  const { showToast } = useToast();
  const { isAuthenticated, requireAuth } = useSupervisorAuth();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const searchParams = useSearchParams();
  const [brief, setBrief] = useState(() => searchParams.get("brief") ?? "");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BriefSearchResponse | null>(null);
  const [searchTimeMs, setSearchTimeMs] = useState<number | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [refinements, setRefinements] = useState<string[]>([]);
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<ScorePaymentReceipt | null>(null);
  const [preferPaid, setPreferPaid] = useState(true);

  const runSearch = useCallback(async (text: string, opts?: { paid?: boolean }) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 500) return;
    setLoading(true);
    setSubmitAttempted(true);
    setSearchTimeMs(null);
    const t0 = performance.now();
    const trackCatalogSearch = (res: BriefSearchResponse, paid: boolean) => {
      const mode = res.catalog.mode ?? 'empty';
      track('brief_search', { len: trimmed.length, paid, catalog_mode: mode });
      track('catalog_results', {
        catalog_mode: mode,
        demo_result_count: res.catalog.demo_result_count,
        live_result_count: res.catalog.live_result_count,
        total: res.total,
      });
    };
    try {
      const usePaid = !!opts?.paid && isAuthenticated && isConnected && preferPaid;
      if (usePaid) {
        try {
          const res = await searchByBriefPaid({
            brief: trimmed,
            limit: 20,
            chainId: chainId || 5042002,
            signTypedDataAsync: signTypedDataAsync as never,
          });
          setSearchTimeMs(Math.round(performance.now() - t0));
          setResults(res);
          setPayment(res.payment);
          trackCatalogSearch(res, true);
          if (res.rows.length === 0) {
            showToast("No matches — try a broader brief.", "info");
          } else {
            showToast(
              `Scored evaluation complete · $${SCORE_FEE_USDC} USDC${res.payment.mock ? " (mock)" : ""}`,
              "success",
              2500,
            );
          }
          void apiClient.logSearch({ briefText: trimmed, resultsCount: res.total }).catch(() => {});
          return;
        } catch (err) {
          const msg = (err as Error).message || "";
          if (/reject|denied|cancel/i.test(msg)) {
            showToast("Signature skipped — running free search", "info", 2500);
          } else {
            showToast(`Paid score unavailable — free search. ${msg}`, "info", 3000);
          }
        }
      }

      const res = await apiClient.searchByBrief({ brief: trimmed, limit: 20 });
      setSearchTimeMs(Math.round(performance.now() - t0));
      setResults(res);
      setPayment(null);
      trackCatalogSearch(res, false);
      if (res.rows.length === 0) {
        showToast("No matches — try a broader brief.", "info");
      }
      void apiClient.logSearch({ briefText: trimmed, resultsCount: res.total }).catch(() => {});
    } catch (err) {
      showToast(`Search failed: ${(err as Error).message}`, "error");
      setResults(null);
      setPayment(null);
    } finally {
      setLoading(false);
    }
  }, [showToast, isAuthenticated, isConnected, preferPaid, chainId, signTypedDataAsync]);

  useEffect(() => {
    if (brief.trim().length < 3 || submitAttempted || results) return;
    const timer = window.setTimeout(() => {
      void runSearch(brief, { paid: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [brief, runSearch, submitAttempted, results]);

  useEffect(() => {
    if (!isAuthenticated) return;
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
      void runSearch([brief.trim(), ...next].filter(Boolean).join(" · "), { paid: false });
    },
    [brief, refinements, runSearch],
  );
  const removeRefinement = useCallback(
    (instruction: string) => {
      const next = refinements.filter((r) => r !== instruction);
      setRefinements(next);
      void runSearch([brief.trim(), ...next].filter(Boolean).join(" · "), { paid: false });
    },
    [brief, refinements, runSearch],
  );

  const hasResults = results && results.rows.length > 0 && !loading;
  const canPayAgents = isAuthenticated && isConnected && preferPaid;
  const effectiveBrief = [brief.trim(), ...refinements].filter(Boolean).join(" · ");

  return (
    <section>
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
            onClick={() => {
              if (canPayAgents) {
                void runSearch(brief, { paid: true });
              } else if (isAuthenticated && !isConnected) {
                requireAuth();
              } else {
                void runSearch(brief, { paid: false });
              }
            }}
            disabled={loading || brief.trim().length < 3}
            className="self-end bg-[var(--color-ink)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors disabled:opacity-40"
          >
            {loading ? "..." : canPayAgents ? `Match · $${SCORE_FEE_USDC}` : "Match"}
          </button>
        </div>
        {isAuthenticated && isConnected && (
          <label className="mt-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] cursor-pointer">
            <input
              type="checkbox"
              checked={preferPaid}
              onChange={(e) => setPreferPaid(e.target.checked)}
              className="accent-[var(--color-rust)]"
            />
            Request scored evaluation · ${SCORE_FEE_USDC} USDC via x402
          </label>
        )}
        {!hasResults && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              Try:
            </span>
            {EXAMPLE_BRIEFS.slice(0, 4).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => { setBrief(e.brief); void runSearch(e.brief, { paid: false }); }}
                className="border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
              >
                {e.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <AgentThinkingPulse paid={canPayAgents} />}

      {hasResults && (
        <div>
          <CatalogDisclosure catalog={results.catalog} />
          <DecisionSummary row={results.rows[0]} total={results.total} />
          <AgentTrace searchTimeMs={searchTimeMs} trackCount={results.rows.length} payment={payment} />

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
                  brief={effectiveBrief || brief}
                  scoreDelay={Math.min(i * 0.06, 0.4) + 0.12}
                  isShortlisted={isAuthenticated && shortlistedIds.has(r.submission_id)}
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

function CatalogDisclosure({ catalog }: { catalog: BriefSearchResponse['catalog'] }) {
  if (catalog.mode !== 'guided_demo') return null;
  return (
    <aside className="mb-4 border border-[var(--color-rust)] bg-[var(--color-paper-2)] px-4 py-3" aria-label="Guided demo catalog">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-rust)]">Guided demo catalog</p>
      <p className="mt-1 font-serif text-sm leading-snug text-[var(--color-ink-2)]">
        These sample takes let you test brief matching, listening, and feedback. License terms are illustrative only: no license job, payment, or settlement will be created.
      </p>
    </aside>
  );
}

function DecisionSummary({ row, total }: { row: BriefSearchRow; total: number }) {
  const evidence = row.why_fits.slice(0, 2).join(" · ");
  return (
    <section className="mb-4 border-l-2 border-[var(--color-rust)] bg-[var(--color-paper-2)] px-4 py-3" aria-label="Top recommendation">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-rust)]">Top recommendation</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="font-serif text-lg font-semibold">{row.title}</h2>
        <span className="font-serif text-sm text-[var(--color-ink-2)]">{row.artist_name}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">match score {row.fit_score}</span>
      </div>
      <p className="mt-1 font-serif text-sm leading-snug text-[var(--color-ink-2)]">
        {evidence ? `Best available match on the returned catalog evidence: ${evidence}.` : "Best available match from the returned catalog evidence."}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
        Human gate · listen for opening, dialogue space, and edit point · {total} matches considered
      </p>
    </section>
  );
}

function MatchRow({
  row,
  rank,
  brief,
  scoreDelay,
  isShortlisted,
  onShortlisted,
  isAuthenticated,
  requireAuth,
}: {
  row: BriefSearchRow;
  rank: number;
  brief: string;
  scoreDelay: number;
  isShortlisted: boolean;
  onShortlisted: (submissionId: string) => void;
  isAuthenticated: boolean;
  requireAuth: (returnTo?: string) => boolean;
}) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [showLicensePanel, setShowLicensePanel] = useState(false);
  const [usageType, setUsageType] = useState<LicenseUsageType>("sync_tv_film");
  const [licensing, setLicensing] = useState(false);
  const [licenseRequest, setLicenseRequest] = useState<LicenseRow | null>(null);
  const [justShortlisted, setJustShortlisted] = useState(false);
  const [feedback, setFeedback] = useState<"good_fit" | "wrong_fit" | null>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const reason = row.why_fits[0] ?? null;
  const quoteOptions = row.license_quote.usage_options.filter(({ usage_type }) => usage_type !== "other");
  const selectedQuote = row.license_quote.usage_options.find(({ usage_type }) => usage_type === usageType);
  const isDemo = row.catalog.source === 'demo';

  const returnTo = typeof window !== "undefined"
    ? `${window.location.pathname}${window.location.search}`
    : "/discover";

  const onShortlist = async () => {
    if (isDemo) {
      onShortlisted(row.submission_id);
      setJustShortlisted(true);
      track('match_shortlist', { catalog_source: 'demo', persisted: false });
      showToast('Saved in this guided-demo session — live catalog shortlists persist to your dashboard.', 'success', 3000);
      return;
    }
    if (!requireAuth(returnTo)) return;
    try {
      await apiClient.addInterest({ submissionId: row.submission_id });
      onShortlisted(row.submission_id);
      setJustShortlisted(true);
      track('match_shortlist', { catalog_source: 'live', persisted: true });
      showToast("Added to shortlist — view on dashboard", "success", 2500);
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, "error");
    }
  };

  const onFeedback = async (verdict: "good_fit" | "wrong_fit") => {
    if (sendingFeedback || feedback === verdict) return;
    setSendingFeedback(true);
    try {
      await apiClient.recordMatchFeedback({
        briefHash: matchBriefHash(brief),
        briefText: brief,
        submissionId: row.submission_id,
        fitScoreShown: row.fit_score,
        rankShown: rank,
        verdict,
      });
      setFeedback(verdict);
      track('match_feedback', { catalog_source: row.catalog.source, verdict });
      showToast(
        isDemo
          ? 'Guided-demo feedback saved for product evaluation.'
          : verdict === "good_fit"
            ? "Good fit recorded — this strengthens the match benchmark."
            : "Wrong direction recorded — this improves future ranking.",
        "success",
        3000,
      );
    } catch (err) {
      showToast(`Could not save feedback: ${(err as Error).message}`, "error");
    } finally {
      setSendingFeedback(false);
    }
  };

  const onRequestLicense = async () => {
    if (isDemo) {
      setShowLicensePanel(false);
      track('demo_license_preview', { catalog_source: 'demo', usage_type: usageType });
      showToast('Preview complete — this demo take cannot open a license job or settlement.', 'info', 3000);
      return;
    }
    if (!requireAuth(returnTo)) return;
    if (!selectedQuote) {
      showToast("No quote is available for that usage type.", "error");
      return;
    }
    setLicensing(true);
    try {
      await apiClient.addInterest({ submissionId: row.submission_id }).catch(() => {});
      onShortlisted(row.submission_id);
      const { license } = await apiClient.createLicense({
        submissionId: row.submission_id,
        briefHash: matchBriefHash(brief),
        briefText: brief,
        usageType: selectedQuote.usage_type,
      });
      setLicenseRequest(license);
      setShowLicensePanel(false);
      showToast("License job opened — continue to settlement when ready.", "success", 3000);
    } catch (err) {
      showToast(`License failed: ${(err as Error).message}`, "error");
    } finally {
      setLicensing(false);
    }
  };

  const onLicenseClick = () => {
    if (isDemo) {
      setShowLicensePanel((p) => !p);
      return;
    }
    if (!requireAuth(returnTo)) return;
    setShowLicensePanel((p) => !p);
  };

  const reviewCountLabel = `${row.rating_count} curator review${row.rating_count === 1 ? "" : "s"}`;

  return (
    <article
      role="listitem"
      className={cn(
        "border border-[var(--color-hair)] rounded-sm transition-all duration-200 hover:border-[var(--color-ink-3)] hover:shadow-sm",
        expanded && "border-[var(--color-ink)] shadow-sm",
        justShortlisted && "border-[var(--color-rust)]",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((p) => !p)}
        className="group w-full p-3 text-left"
      >
        <div className="flex items-center gap-3">
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

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-[15px] font-semibold truncate">{row.title}</span>
              <span className="font-serif text-[13px] text-[var(--color-ink-2)] truncate">{row.artist_name}</span>
              <span className={cn(
                'font-mono text-[8px] uppercase tracking-[0.1em] px-1 py-0.5 rounded-sm',
                isDemo ? 'bg-[var(--color-rust)] text-[var(--color-paper)]' : 'bg-[var(--color-paper-2)] text-[var(--color-ink-3)]',
              )}>{row.catalog.label}</span>
            </div>
            {reason && (
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--color-ink-3)] truncate mt-0.5">
                Evidence · {reason}
              </p>
            )}
          </div>

          <FitScorePop score={row.fit_score} delay={scoreDelay} />

          <span className="font-mono text-[8px] text-[var(--color-ink-3)] shrink-0 bg-[var(--color-paper-2)] px-1.5 py-0.5 rounded-sm">
            {row.rating_count} review{row.rating_count === 1 ? "" : "s"}
          </span>

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

              <div className="mt-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">Match evidence</p>
                {row.why_fits.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {row.why_fits.map((evidence, index) => (
                      <span key={`${evidence}-${index}`} className="bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-ink-2)] rounded-sm">
                        {evidence}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 font-serif text-[13px] text-[var(--color-ink-2)]">No citation was returned for this match.</p>
                )}
              </div>

              <div className="mt-3 border-l-2 border-[var(--color-hair-strong)] pl-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">Human gate</p>
                <p className="mt-0.5 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                  Confirm the opening, dialogue space, and edit point against picture before licensing.
                </p>
              </div>

              <div className="mt-3" role="group" aria-label={`Match feedback for ${row.title}`}>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">Would you put this under the brief?</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void onFeedback("good_fit")}
                    disabled={sendingFeedback}
                    aria-pressed={feedback === "good_fit"}
                    className={cn(
                      "border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide transition-colors disabled:opacity-50",
                      feedback === "good_fit"
                        ? "border-[var(--color-rust)] bg-[var(--color-rust)] text-[var(--color-paper)]"
                        : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                    )}
                  >
                    Good fit
                  </button>
                  <button
                    type="button"
                    onClick={() => void onFeedback("wrong_fit")}
                    disabled={sendingFeedback}
                    aria-pressed={feedback === "wrong_fit"}
                    className={cn(
                      "border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide transition-colors disabled:opacity-50",
                      feedback === "wrong_fit"
                        ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]"
                        : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-ink)]",
                    )}
                  >
                    Wrong direction
                  </button>
                  <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--color-ink-3)]">{reviewCountLabel}</span>
                </div>
                {feedback && (
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--color-rust)]">
                    {isDemo
                      ? 'Feedback saved for guided-demo evaluation.'
                      : 'Feedback saved to the match benchmark.'}
                  </p>
                )}
              </div>

              <div className="mt-3 border-t border-[var(--color-hair)] pt-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                  {isDemo ? 'Guided demo preview' : 'Requestable'} · {row.license_availability.reason}
                </p>
                <p className="mt-1 font-mono text-[9px] text-[var(--color-ink-3)]">
                  {isDemo ? 'Sample schedule' : 'Indicative platform quote'} · {row.license_quote.territory} · {row.license_quote.term_months} months
                </p>
                <p className="mt-1 font-mono text-[9px] text-[var(--color-ink-3)]">
                  Clearance unverified · {row.license_availability.clearance.reason}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => void onShortlist()}
                    disabled={isShortlisted}
                    className={cn(
                      "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-sm transition-colors",
                      isShortlisted
                        ? "bg-[var(--color-rust)] text-[var(--color-paper)] opacity-90"
                        : isDemo || isAuthenticated
                          ? "bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-rust)]"
                          : "border border-[var(--color-ink-3)] text-[var(--color-ink-3)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                    )}
                  >
                    {isShortlisted ? (
                      <>
                        <SuccessCheck active />
                        Shortlisted
                      </>
                    ) : isDemo ? (
                      "Save demo"
                    ) : isAuthenticated ? (
                      "Shortlist"
                    ) : (
                      "Sign in to shortlist"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onLicenseClick}
                    disabled={!!licenseRequest}
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-[0.12em] border px-3 py-1.5 rounded-sm transition-colors disabled:opacity-60",
                      showLicensePanel
                        ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                        : isDemo || isAuthenticated
                          ? "border-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
                          : "border-[var(--color-ink-3)] text-[var(--color-ink-3)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                    )}
                  >
                    {licenseRequest ? "License job open" : isDemo ? "Preview license flow" : isAuthenticated ? "Review license terms" : "Sign in to license"}
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
              </div>

              {licenseRequest && (
                <div className="mt-3 border border-[var(--color-rust)] bg-[var(--color-paper-2)] px-3 py-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)]">License job opened</p>
                  <p className="mt-1 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                    {USAGE_LABELS[licenseRequest.usage_type]} · ${licenseRequest.fee_usdc} USDC · {licenseRequest.territory} · {licenseRequest.term_months} months.
                  </p>
                  <Link href="/supervisor#licenses" className="mt-1.5 inline-block font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-rust)] hover:text-[var(--color-ink)]">
                    Continue to settlement →
                  </Link>
                </div>
              )}

              <AnimatePresence>
                {showLicensePanel && (isDemo || isAuthenticated) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pt-3 border-t border-[var(--color-hair)]">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-2">
                        Usage type · {isDemo ? 'sample guided-demo schedule' : 'indicative platform quote on Arc USDC'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {quoteOptions.map((option) => (
                          <button
                            key={option.usage_type}
                            type="button"
                            onClick={() => setUsageType(option.usage_type)}
                            className={cn(
                              "font-mono text-[9px] uppercase tracking-wide px-2.5 py-1 rounded-sm border transition-colors",
                              usageType === option.usage_type
                                ? "bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]"
                                : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)]",
                            )}
                          >
                            {USAGE_LABELS[option.usage_type]} · ${option.fee_usdc}
                          </button>
                        ))}
                      </div>
                      <p className="font-mono text-[9px] text-[var(--color-ink-3)] mb-3">
                        {row.license_quote.territory} · {row.license_quote.term_months} months · {isDemo
                          ? 'illustrative only; previewing will not create a job, payment, or settlement.'
                          : 'opens a license job after your approval. Rights clearance remains unverified.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => void onRequestLicense()}
                        disabled={licensing || !selectedQuote}
                        className="inline-flex items-center gap-2 bg-[var(--color-rust)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2 rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {licensing ? (
                          <>
                            <motion.span
                              className="inline-block h-3 w-3 rounded-full border border-[var(--color-paper)] border-t-transparent"
                              animate={{ rotate: 360 }}
                              transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                              aria-hidden
                            />
                            Creating…
                          </>
                        ) : (
                          isDemo
                            ? `Preview only · sample $${selectedQuote?.fee_usdc ?? "—"} USDC`
                            : `Open license job · $${selectedQuote?.fee_usdc ?? "—"} USDC`
                        )}
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
