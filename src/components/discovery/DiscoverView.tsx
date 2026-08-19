"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { SceneCard } from "@/components/discovery/SceneCard";
import { AgentThinkingPulse, FitScorePop, SuccessCheck } from "@/components/discovery/motion";
import { PipelineStepper } from "@/components/economy/PipelineStepper";

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
  // The brief that arrived via ?brief= deep link. Auto-search fires ONLY
  // for this value on mount — a supervisor typing a fresh brief on
  // /discover must be able to finish the sentence before anything runs.
  const initialBriefRef = useRef(searchParams.get("brief") ?? "");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BriefSearchResponse | null>(null);
  const [searchTimeMs, setSearchTimeMs] = useState<number | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [refinements, setRefinements] = useState<string[]>([]);
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<ScorePaymentReceipt | null>(null);
  // OPT-IN: enhanced (paid) scoring defaults OFF so the primary action
  // stays the free match for every user — the wallet is the rail,
  // never the front door (STRATEGY §2). Supervisors opt in via
  // "Search settings".
  const [preferPaid, setPreferPaid] = useState(false);
  // The case this search opened/resumed. Used to attach shortlists to the
  // EXPLICIT case (never "most recently active") and to surface a recoverable
  // sync failure instead of silently swallowing it.
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);
  const [caseSyncFailed, setCaseSyncFailed] = useState(false);

  const runSearch = useCallback(async (text: string, opts?: { paid?: boolean; baseBrief?: string; logSearch?: boolean }) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 500) return;
    setLoading(true);
    setSubmitAttempted(true);
    setSearchTimeMs(null);
    const t0 = performance.now();
    // Open/resume the persistent placement case for this brief (works for both
    // free and paid searches). Remembers the case id so shortlists attach to
    // the right case, and surfaces a recoverable failure state.
    //
    // Cases are keyed on the BASE brief, not the refined search string:
    // refining ("darker", "no vocals") is iteration INSIDE the same case,
    // not a new placement. Without this, every refinement chip minted a
    // near-duplicate case in the workspace.
    const caseKey = (opts?.baseBrief ?? trimmed).trim();
    const syncCase = (res: BriefSearchResponse) => {
      void apiClient
        .openCase({
          briefText: caseKey,
          rankedCount: res.total,
          candidateTitles: res.rows.slice(0, 3).map((r) => r.title ?? "").filter(Boolean),
        })
        .then((r) => {
          setCurrentCaseId(r.row.id);
          setCaseSyncFailed(false);
        })
        .catch(() => {
          setCurrentCaseId(null);
          setCaseSyncFailed(true);
        });
    };
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
          // searchLatencyMs excludes the wallet signature wait — the vitals
          // p50/p95 measure the actual scoring, not human approval speed.
          const { response: res, searchLatencyMs } = await searchByBriefPaid({
            brief: trimmed,
            limit: 20,
            chainId: chainId || 5042002,
            signTypedDataAsync: signTypedDataAsync as never,
          });
          setSearchTimeMs(searchLatencyMs);
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
          if (opts?.logSearch !== false) {
            void apiClient.logSearch({ briefText: trimmed, resultsCount: res.total, durationMs: searchLatencyMs }).catch(() => {});
          }
          syncCase(res);
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
      if (opts?.logSearch !== false) {
        void apiClient.logSearch({ briefText: trimmed, resultsCount: res.total, durationMs: Math.round(performance.now() - t0) }).catch(() => {});
      }
      syncCase(res);
    } catch (err) {
      showToast(`Search failed: ${(err as Error).message}`, "error");
      setResults(null);
      setPayment(null);
    } finally {
      setLoading(false);
    }
  }, [showToast, isAuthenticated, isConnected, preferPaid, chainId, signTypedDataAsync]);

  // Auto-run exactly once, and only for a deep-linked ?brief= that the user
  // hasn't edited. Typed input never auto-searches. The setTimeout defers
  // the first setState out of the synchronous effect body (lint rule).
  useEffect(() => {
    if (!initialBriefRef.current) return;
    if (brief !== initialBriefRef.current) return;
    if (brief.trim().length < 3 || submitAttempted || results) return;
    const timer = window.setTimeout(() => {
      void runSearch(brief, { paid: false, baseBrief: brief });
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
      void runSearch([brief.trim(), ...next].filter(Boolean).join(" · "), { paid: false, baseBrief: brief, logSearch: false });
    },
    [brief, refinements, runSearch],
  );
  const removeRefinement = useCallback(
    (instruction: string) => {
      const next = refinements.filter((r) => r !== instruction);
      setRefinements(next);
      void runSearch([brief.trim(), ...next].filter(Boolean).join(" · "), { paid: false, baseBrief: brief, logSearch: false });
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
                void runSearch(brief, { paid: true, logSearch: refinements.length === 0 });
              } else if (isAuthenticated && !isConnected) {
                requireAuth();
              } else {
                void runSearch(brief, { paid: false, logSearch: refinements.length === 0 });
              }
            }}
            disabled={loading || brief.trim().length < 3}
            className="self-end bg-[var(--color-ink)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors disabled:opacity-40"
          >
            {loading ? "..." : canPayAgents ? `Match · $${SCORE_FEE_USDC}` : "Match"}
          </button>
        </div>
        {isAuthenticated && isConnected && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]">
              Search settings
            </summary>
            <label className="mt-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] cursor-pointer">
              <input
                type="checkbox"
                checked={preferPaid}
                onChange={(e) => setPreferPaid(e.target.checked)}
                className="accent-[var(--color-rust)]"
              />
              Use enhanced scoring · ${SCORE_FEE_USDC} USDC
            </label>
          </details>
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
                onClick={() => { setBrief(e.brief); void runSearch(e.brief, { paid: false, baseBrief: e.brief }); }}
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
          <ol
            aria-label="Licensing workflow"
            className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-[var(--color-hair)] py-2 font-mono text-[9px] uppercase tracking-[0.12em]"
          >
            <li className="text-[var(--color-ink-3)]">1. Brief</li>
            <li aria-hidden className="text-[var(--color-hair-strong)]">/</li>
            <li aria-current="step" className="text-[var(--color-rust)]">2. Review takes</li>
            <li aria-hidden className="text-[var(--color-hair-strong)]">/</li>
            <li className="text-[var(--color-ink-3)]">3. Rights review</li>
            <li aria-hidden className="text-[var(--color-hair-strong)]">/</li>
            <li className="text-[var(--color-ink-3)]">4. License</li>
          </ol>
          <CatalogDisclosure catalog={results.catalog} />
          <DecisionSummary row={results.rows[0]} total={results.total} />
          <SceneCard
            brief={results.rows[0].brief}
            briefText={effectiveBrief || brief}
            trackTitle={results.rows[0].title}
            artistName={results.rows[0].artist_name}
          />
          <p className="mb-4 font-serif text-sm leading-snug text-[var(--color-ink-2)]">
            Start with a preview. Open a take when you want to compare the fit or review its rights status.
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-5" aria-label="Refine this brief">
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
            {(() => {
              // Build family groups: rows sharing a family_id form a version family
              // We preserve fit_score ranking: families appear where their best match would be
              const familyGroups: Map<string, BriefSearchRow[]> = new Map();
              results.rows.forEach((r) => {
                if (r.family_id) {
                  if (!familyGroups.has(r.family_id)) familyGroups.set(r.family_id, []);
                  familyGroups.get(r.family_id)!.push(r);
                }
              });

              const familySet = new Set(familyGroups.keys());
              const renderedFamilies = new Set<string>();

              // Walk results.rows in order, rendering each item or family group once
              const items: React.ReactNode[] = [];
              let idx = 0;
              for (let i = 0; i < results.rows.length; i++) {
                const r = results.rows[i];
                const animDelay = Math.min(idx * 0.06, 0.4);
                const rank = i + 1;

                if (r.family_id && !renderedFamilies.has(r.family_id)) {
                  renderedFamilies.add(r.family_id);
                  const family = familyGroups.get(r.family_id)!;
                  const best = family[0];
                  const siblings = family.slice(1);
                  const familyCount = family.length;

                  items.push(
                    <motion.div
                      key={best.submission_id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: animDelay, duration: 0.3 }}
                    >
                      <MatchRow
                        row={best}
                        rank={rank}
                        brief={effectiveBrief || brief}
                        scoreDelay={animDelay + 0.12}
                        caseId={currentCaseId}
                        isShortlisted={isAuthenticated && shortlistedIds.has(best.submission_id)}
                        onShortlisted={markShortlisted}
                        isAuthenticated={isAuthenticated}
                        requireAuth={requireAuth}
                        familyId={best.family_id}
                        familyCount={familyCount}
                      />
                      {siblings.length > 0 && (
                        <VersionFamilySiblings
                          siblings={siblings}
                          brief={effectiveBrief || brief}
                          scoreDelay={animDelay + 0.12}
                          familyId={best.family_id!}
                          familyCount={familyCount}
                          shortlistedIds={shortlistedIds}
                          onShortlisted={markShortlisted}
                          isAuthenticated={isAuthenticated}
                          requireAuth={requireAuth}
                        />
                      )}
                    </motion.div>,
                  );
                  idx++;
                } else {
                  items.push(
                    <motion.div
                      key={r.submission_id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: animDelay, duration: 0.3 }}
                    >
                      <MatchRow
                        row={r}
                        rank={rank}
                        brief={effectiveBrief || brief}
                        scoreDelay={animDelay + 0.12}
                        caseId={currentCaseId}
                        isShortlisted={isAuthenticated && shortlistedIds.has(r.submission_id)}
                        onShortlisted={markShortlisted}
                        isAuthenticated={isAuthenticated}
                        requireAuth={requireAuth}
                      />
                    </motion.div>,
                  );
                  idx++;
                }
              }

              return items;
            })()}
          </div>

          {caseSyncFailed && (
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)]">
              Workspace sync failed — this search couldn&apos;t be saved to your cases. Refresh or retry to open it in the Workspace.
            </p>
          )}

          <details className="mt-5 border-t border-[var(--color-hair)] pt-3">
            <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]">
              Evaluation details
            </summary>
            <div className="pt-3">
              <AgentTrace searchTimeMs={searchTimeMs} trackCount={results.rows.length} payment={payment} />
            </div>
          </details>
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

function VersionFamilySiblings({
  siblings,
  brief,
  scoreDelay,
  familyId,
  familyCount,
  shortlistedIds,
  onShortlisted,
  isAuthenticated,
  requireAuth,
}: {
  siblings: BriefSearchRow[];
  brief: string;
  scoreDelay: number;
  familyId: string;
  familyCount: number;
  shortlistedIds: Set<string>;
  onShortlisted: (submissionId: string) => void;
  isAuthenticated: boolean;
  requireAuth: (returnTo?: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="ml-4 mt-1 pl-3 border-l border-[var(--color-hair)]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
        aria-expanded={expanded}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={cn("transition-transform", expanded && "rotate-90")}
          aria-hidden
        >
          <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {siblings.length} version{siblings.length > 1 ? 's' : ''} in this family
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mt-1 space-y-1"
          >
            {siblings.map((sibling, i) => (
              <motion.div
                key={sibling.submission_id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
              >
                <MatchRow
                  row={sibling}
                  rank={0}
                  brief={brief}
                  scoreDelay={scoreDelay}
                  isAuthenticated={isAuthenticated}
                  requireAuth={requireAuth}
                  onShortlisted={onShortlisted}
                  isShortlisted={isAuthenticated && shortlistedIds.has(sibling.submission_id)}
                  familyId={familyId}
                  familyCount={familyCount}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
  caseId,
  isShortlisted,
  onShortlisted,
  isAuthenticated,
  requireAuth,
  familyId,
  familyCount,
}: {
  row: BriefSearchRow;
  rank: number;
  brief: string;
  scoreDelay: number;
  caseId?: string | null;
  isShortlisted: boolean;
  onShortlisted: (submissionId: string) => void;
  isAuthenticated: boolean;
  requireAuth: (returnTo?: string) => boolean;
  familyId?: string;
  familyCount?: number;
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
  const isAuthorized = row.catalog.source === 'authorized';

  // Hover-to-play snippet (10s)
  const snippetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snippetAudioRef = useRef<HTMLAudioElement | null>(null);
  const snippetPlayingRef = useRef(false);
  const [snippetPlaying, setSnippetPlaying] = useState(false);

  const playSnippet = () => {
    if (snippetTimerRef.current) {
      clearTimeout(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }
    snippetTimerRef.current = setTimeout(() => {
      if (snippetAudioRef.current) {
        snippetAudioRef.current.currentTime = 0;
        snippetAudioRef.current.play().catch(() => {});
        snippetPlayingRef.current = true;
        setSnippetPlaying(true);
      }
    }, 200); // debounce 200ms to avoid playing on accidental hover
  };

  const stopSnippet = () => {
    if (snippetTimerRef.current) {
      clearTimeout(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }
    if (snippetAudioRef.current) {
      snippetAudioRef.current.pause();
      snippetAudioRef.current.currentTime = 0;
      snippetPlayingRef.current = false;
      setSnippetPlaying(false);
    }
  };

  // Stop snippet when another one starts playing
  useEffect(() => {
    return () => {
      if (snippetTimerRef.current) clearTimeout(snippetTimerRef.current);
    };
  }, []);

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
      // Attach to the EXPLICIT case this search opened (never "latest open"),
      // so a take can't land on the wrong brief when multiple are open.
      if (caseId) {
        void apiClient
          .addCaseShortlist({ caseId, submissionId: row.submission_id, fitScore: row.fit_score, rank })
          .catch(() => {});
      }
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
        onClick={() => {
          setExpanded((p) => !p);
          if (!expanded) stopSnippet(); // stop snippet when user expands to fully listen
        }}
        onMouseEnter={() => !expanded && playSnippet()}
        onMouseLeave={() => !expanded && stopSnippet()}
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
              {/* Consent badge for authorized versions */}
              {isAuthorized && (
                <span
                  className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 bg-[var(--color-rust)]/10 border border-[var(--color-rust)]/40 cursor-help"
                  title="Artist-authorized: rights holder consent recorded, splits defined, royalty waterfall active"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M5 0.5l1.2 2.5 2.7.4-2 1.9.5 2.7L5 6.2 2.6 8l.5-2.7-2-1.9 2.7-.4z" fill="var(--color-rust)" />
                  </svg>
                  <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-[var(--color-rust)]">Authorized</span>
                </span>
              )}
            </div>
            {reason && (
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--color-ink-3)] truncate mt-0.5">
                Evidence · {reason}
              </p>
            )}
            {/* Inline why_fits chips (top 2) */}
            {row.why_fits.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {row.why_fits.slice(0, 2).map((fit, idx) => (
                  <span
                    key={`${fit}-${idx}`}
                    className="bg-[var(--color-paper-2)] border border-[var(--color-hair)] px-1.5 py-0.3 font-mono text-[8px] uppercase tracking-wide text-[var(--color-ink-2)] rounded-sm truncate max-w-[220px]"
                    title={fit}
                  >
                    {fit.length > 48 ? `${fit.slice(0, 45)}…` : fit}
                  </span>
                ))}
              </div>
            )}
            {/* Snippet playing indicator */}
            {snippetPlaying && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-rust)] animate-pulse" />
                <span className="font-mono text-[8px] text-[var(--color-ink-3)]">Snippet playing</span>
              </div>
            )}
          </div>

          <FitScorePop score={row.fit_score} delay={scoreDelay} />

          <span className="font-mono text-[8px] text-[var(--color-ink-3)] shrink-0 bg-[var(--color-paper-2)] px-1.5 py-0.5 rounded-sm">
            {row.rating_count} review{row.rating_count === 1 ? "" : "s"}
          </span>

          <span className={cn(
            "hidden shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] sm:inline-flex",
            row.licensing_evidence.status === "sample_only"
              ? "bg-[var(--color-paper-2)] text-[var(--color-ink-3)]"
              : "bg-[var(--color-rust)] text-[var(--color-paper)]",
          )}>
            {isDemo ? "Preview" : row.licensing_evidence.status === "sample_only" ? "Sample only" : "Requestable"}
          </span>

          <span className={cn(
            "shrink-0 rounded-sm px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] transition-all duration-200",
            expanded
              ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
              : "bg-[var(--color-paper-2)] text-[var(--color-ink-3)] group-hover:bg-[var(--color-rust)] group-hover:text-[var(--color-paper)]",
          )}>
            <span className="sm:hidden">{expanded ? "Close" : "Review"}</span>
            <span className="hidden sm:inline">{expanded ? "Close" : "Review fit"}</span>
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
              {/* Pipeline stepper (live updates during agent review) */}
              <PipelineStepper
                status={row.status}
                ratingCount={row.rating_count}
              />

              <AudioPlayer
                src={`/api/v1/uploads/${row.audio_path?.split("/").pop() ?? ""}`}
                title={row.title}
                by={row.artist_name}
              />

              <div className="mt-3 border-t border-[var(--color-hair)] pt-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                  Why this fits
                </p>
                {row.why_fits.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {row.why_fits.map((evidence, index) => (
                      <span key={`${evidence}-${index}`} className="bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-ink-2)] rounded-sm">
                        {evidence}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 font-serif text-[13px] text-[var(--color-ink-2)]">No citation was returned for this match.</p>
                )}
              </div>

              <div className="mt-3 border-l-2 border-[var(--color-hair-strong)] pl-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">Human gate</p>
                <p className="mt-0.5 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                  Confirm the opening, dialogue space, and edit point against picture before licensing.
                </p>
              </div>

              <details className="mt-3" role="group" aria-label={`Match feedback for ${row.title}`}>
                <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]">
                  Help tune future matches
                </summary>
                <p className="mt-2 font-serif text-[13px] text-[var(--color-ink-2)]">Would you put this under the brief?</p>
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
                      ? "Feedback saved for guided-demo evaluation."
                      : "Feedback saved to the match benchmark."}
                  </p>
                )}
              </details>

              <details open className="mt-3 border-t border-[var(--color-hair)] pt-3">
                <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]">
                  Rights &amp; licensing · {row.licensing_evidence.status === "sample_only" ? "sample only" : "review required"}
                </summary>
                <div className="pt-2">
                  <p className="font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                    {isDemo ? "Illustrative schedule only." : "Indicative terms are available; rights review remains required before a license is confirmed."}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-[var(--color-ink-3)]">
                    {isDemo ? "Sample schedule" : "Indicative platform quote"} · {row.license_quote.territory} · {row.license_quote.term_months} months
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-[var(--color-ink-3)]">
                    {row.licensing_evidence.summary}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 font-mono text-[8px] leading-snug text-[var(--color-ink-3)]" aria-label="Outstanding licensing evidence">
                    {row.licensing_evidence.outstanding.map((item) => (
                      <li key={item.requirement}>• {item.description}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 mt-3">
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
                      {licenseRequest ? "License job open" : isDemo ? "Preview license flow" : isAuthenticated ? "Review terms" : "Sign in to review terms"}
                    </button>
                    {isAuthenticated && (
                      <Link
                        href="/supervisor"
                        className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] px-1 py-1.5 transition-colors"
                      >
                        Workspace →
                      </Link>
                    )}
                  </div>
                </div>
              </details>

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

      {/* Hidden audio element for hover-to-play snippet */}
      <audio
        ref={snippetAudioRef}
        src={`/api/v1/uploads/${row.audio_path?.split("/").pop() ?? ""}`}
        preload="metadata"
        onEnded={() => setSnippetPlaying(false)}
        className="hidden"
      />
    </article>
  );
}
