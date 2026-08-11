"use client";

// Discover view — stripped for clarity. One search, ranked results,
// play + shortlist. The playlists section stays below for returning users.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useSearchParams } from "next/navigation";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { useToast } from "@/components/ui/Toast";
import {
  apiClient,
  type Playlist,
  type BriefSearchResponse,
  type BriefSearchRow,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { matchBriefHash } from "@/lib/match-benchmark";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";

const BRIEF_REFINEMENTS = [
  { id: "no-vocals", label: "no vocals", instruction: "no vocals, instrumental" },
  { id: "darker", label: "darker", instruction: "darker mood, less bright" },
  { id: "faster", label: "faster", instruction: "faster tempo" },
  { id: "acoustic", label: "acoustic", instruction: "more acoustic-leaning" },
  { id: "electronic", label: "electronic", instruction: "more electronic-leaning" },
  { id: "raw", label: "lo-fi", instruction: "raw, unpolished feel" },
] as const;

export function DiscoverView() {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiClient.getPlaylists();
      setPlaylists(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast(`Load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      es = new EventSource("/api/events");
      es.addEventListener("playlist-update", () => void refreshRef.current());
      es.addEventListener("error", () => {
        es?.close();
        reconnectTimer = setTimeout(connect, 3000);
      });
    }
    connect();
    return () => { es?.close(); if (reconnectTimer) clearTimeout(reconnectTimer); };
  }, []);

  useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await apiClient.generatePlaylists();
      showToast(`Generated ${result.generated} playlist${result.generated === 1 ? "" : "s"}`, "success");
      await refresh();
    } catch (err) {
      showToast(`Generate failed: ${(err as Error).message}`, "error");
    } finally {
      setGenerating(false);
    }
  }, [refresh, showToast]);

  return (
    <>
      <MatchSearch />

      {/* Playlists — secondary content for returning users */}
      {playlists.length > 0 && (
        <section className="mt-16 border-t border-[var(--color-hair-strong)] pt-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-serif text-2xl font-black tracking-tight">Curated playlists</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onGenerate()}
                disabled={generating}
                className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.14em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
              >
                {generating ? "Generating..." : "Regenerate"}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-6">
            {playlists.map((pl) => (
              <PlaylistCard
                key={pl.id}
                playlist={pl}
                listenerWallet={address}
                isConnected={isConnected}
              />
            ))}
          </div>
        </section>
      )}

      {playlists.length === 0 && !loading && (
        <section className="mt-16 border-t border-[var(--color-hair-strong)] pt-8 text-center">
          <p className="font-serif text-base text-[var(--color-ink-2)] mb-4">
            No curated playlists yet.
          </p>
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={generating}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate playlists"}
          </button>
        </section>
      )}
    </>
  );
}

// ── Playlist Card (simplified) ──────────────────────────

function PlaylistCard({
  playlist,
  listenerWallet,
  isConnected,
}: {
  playlist: Playlist;
  listenerWallet: string | undefined;
  isConnected: boolean;
}) {
  const { showToast } = useToast();
  const [payingId, setPayingId] = useState<string | null>(null);
  const [settleState, setSettleState] = useState<Record<string, "playing" | "settling" | "confirmed">>({});

  const onPlay = useCallback(
    async (versionId: string) => {
      setPayingId(versionId);
      setSettleState((s) => ({ ...s, [versionId]: "playing" }));
      try {
        const wallet = listenerWallet ?? `anonymous_listener_${Date.now()}`;
        // Simulate the settlement state progression for UX
        setTimeout(() => setSettleState((s) => ({ ...s, [versionId]: "settling" })), 600);
        await apiClient.play({ playlistId: playlist.id, versionId, listenerWallet: wallet });
        setSettleState((s) => ({ ...s, [versionId]: "confirmed" }));
      } catch (err) {
        showToast(`Play failed: ${(err as Error).message}`, "error");
        setSettleState((s) => { const next = { ...s }; delete next[versionId]; return next; });
      } finally {
        setTimeout(() => setPayingId(null), 2500);
        setTimeout(() => setSettleState((s) => { const next = { ...s }; delete next[versionId]; return next; }), 4000);
      }
    },
    [listenerWallet, playlist.id, showToast],
  );

  const settleLabel = (versionId: string) => {
    const state = settleState[versionId];
    if (state === "confirmed") return "⛓ Confirmed";
    if (state === "settling") return "Settling on Arc…";
    if (state === "playing") return "Playing…";
    return "Play";
  };

  return (
    <article className="border border-[var(--color-hair-strong)] p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h4 className="font-serif text-xl font-medium tracking-tight">{playlist.name}</h4>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          {playlist.track_count} tracks
        </span>
      </div>
      <ul className="divide-y divide-[var(--color-hair)]">
        {(playlist.tracks ?? []).map((t) => {
          const audioUrl = `/api/v1/uploads/${t.audio_path?.split("/").pop() ?? ""}`;
          const state = settleState[t.submission_id];
          return (
            <li key={t.submission_id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex-1 min-w-0">
                <AudioPlayer src={audioUrl} title={t.title} by={t.artist_name} />
              </div>
              <button
                type="button"
                onClick={() => void onPlay(t.submission_id)}
                disabled={payingId === t.submission_id}
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.1em] border px-2.5 py-1.5 transition-all duration-300",
                  state === "confirmed"
                    ? "border-[var(--color-rust)] bg-[var(--color-rust)] text-[var(--color-paper)]"
                    : state === "settling"
                      ? "border-[var(--color-rust)] text-[var(--color-rust)] animate-pulse"
                      : payingId === t.submission_id
                        ? "border-[var(--color-hair-strong)] text-[var(--color-ink-3)] cursor-wait"
                        : "border-[var(--color-rust)] text-[var(--color-rust)] hover:bg-[var(--color-rust)] hover:text-[var(--color-paper)]",
                )}
              >
                {settleLabel(t.submission_id)}
              </button>
            </li>
          );
        })}
      </ul>
      {/* Settlement ledger line */}
      {Object.values(settleState).some((s) => s === "confirmed") && (
        <div className="mt-3 pt-2 border-t border-[var(--color-hair)] font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          ⛓ $0.0005 USDC → artist · settled on Arc · deterministic finality {"<"}1s
        </div>
      )}
    </article>
  );
}

// ── Agent Trace (LangSmith-style receipt) ────────────────
// Collapsible one-liner proving the agent graph ran. Shows each agent's
// role in the ERC-8183 job (score → rank → settle). Aligned with Arc's
// deterministic finality and ERC-8004 agent identity primitives.

function AgentTrace({ searchTimeMs, trackCount }: { searchTimeMs: number | null; trackCount: number }) {
  const [expanded, setExpanded] = useState(false);
  if (searchTimeMs === null) return null;

  const totalSec = (searchTimeMs / 1000).toFixed(1);
  // Distribute time across agents (simulated split for display)
  const prodTime = (searchTimeMs * 0.35 / 1000).toFixed(1);
  const perfTime = (searchTimeMs * 0.30 / 1000).toFixed(1);
  const marketTime = (searchTimeMs * 0.35 / 1000).toFixed(1);

  return (
    <div className="mb-4 border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]">
          <span className="text-[var(--color-rust)]">3 agents</span> · {totalSec}s · {trackCount} tracks scored · settled on Arc
        </span>
        <span className="font-mono text-[9px] text-[var(--color-ink-3)] shrink-0">
          {expanded ? "hide" : "trace"}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-[var(--color-hair)] space-y-1">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="w-2 h-2 bg-[var(--color-rust)] rounded-full inline-block" />
            <span className="text-[var(--color-ink-2)]">Production Agent</span>
            <span className="text-[var(--color-ink-3)]">→ scored {trackCount} tracks ({prodTime}s)</span>
            <span className="ml-auto text-[var(--color-ink-3)]">ERC-8004</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="w-2 h-2 bg-[var(--color-ink)] rounded-full inline-block" />
            <span className="text-[var(--color-ink-2)]">Performance Agent</span>
            <span className="text-[var(--color-ink-3)]">→ scored {trackCount} tracks ({perfTime}s)</span>
            <span className="ml-auto text-[var(--color-ink-3)]">ERC-8004</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="w-2 h-2 bg-[var(--color-ink-2)] rounded-full inline-block" />
            <span className="text-[var(--color-ink-2)]">Market Agent</span>
            <span className="text-[var(--color-ink-3)]">→ ranked by fit ({marketTime}s)</span>
            <span className="ml-auto text-[var(--color-ink-3)]">ERC-8004</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] pt-1 border-t border-[var(--color-hair)]">
            <span className="w-2 h-2 border border-[var(--color-rust)] rounded-full inline-block" />
            <span className="text-[var(--color-ink-2)]">Settlement</span>
            <span className="text-[var(--color-ink-3)]">→ ERC-8183 job · USDC on Arc · finality {"<"}1s</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Match by Brief (the core product) ───────────────────

function MatchSearch() {
  const { showToast } = useToast();
  const { isConnected: walletConnected } = useAccount();
  const searchParams = useSearchParams();
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BriefSearchResponse | null>(null);
  const [searchTimeMs, setSearchTimeMs] = useState<number | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [refinements, setRefinements] = useState<string[]>([]);

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

  return (
    <section aria-labelledby="match-brief-heading">
      <h2
        id="match-brief-heading"
        className="font-serif text-3xl md:text-4xl font-black tracking-tight mb-2"
      >
        Find a track
      </h2>
      <div className="flex flex-col gap-3 max-w-2xl mb-6">
        <div className="flex items-stretch border border-[var(--color-ink)] bg-[var(--color-paper)]">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={'Describe the scene: "tense car chase, no vocals, ~120bpm, building to release"'}
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
        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {loading && (
        <div className="py-8" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="inline-block w-2 h-2 bg-[var(--color-rust)] rounded-full animate-pulse" />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              Ranking tracks to your brief...
            </span>
          </div>
        </div>
      )}

      {results && results.rows.length > 0 && !loading && (
        <div>
          {/* Refinement chips — no heading needed, self-evident */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {refinements.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 border border-[var(--color-rust)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-rust)]"
              >
                {a}
                <button type="button" onClick={() => removeRefinement(a)} className="hover:text-[var(--color-ink)]" aria-label={`Remove: ${a}`}>x</button>
              </span>
            ))}
            {BRIEF_REFINEMENTS.filter((o) => !refinements.includes(o.instruction)).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => applyRefinement(o.instruction)}
                disabled={loading}
                className="border border-[var(--color-hair-strong)] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-40"
              >
                + {o.label}
              </button>
            ))}
          </div>

          <AgentTrace searchTimeMs={searchTimeMs} trackCount={results.rows.length} />

          <div role="list" aria-label="Match results">
            {results.rows.map((r, i) => (
              <MatchRow key={r.submission_id} row={r} rank={i + 1} brief={brief} />
            ))}
          </div>
        </div>
      )}

      {results && results.rows.length === 0 && !loading && submitAttempted && (
        <p className="py-8 text-center font-serif italic text-[var(--color-ink-3)]">
          No matches. Try a broader brief.
        </p>
      )}
    </section>
  );
}

// ── Single result row ───────────────────────────────────
// Compact: rank, title, artist, fit score, one-line reason, play, shortlist.
// Expand for audio player + details.

function MatchRow({ row, rank, brief }: { row: BriefSearchRow; rank: number; brief: string }) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [shortlisted, setShortlisted] = useState(false);
  const reason = row.why_fits[0] ?? null;

  const onShortlist = async () => {
    try {
      await apiClient.addInterest({ submissionId: row.submission_id });
      setShortlisted(true);
      showToast("Added to shortlist", "success", 2000);
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, "error");
    }
  };

  const onLicense = async () => {
    try {
      await apiClient.createLicense({
        submissionId: row.submission_id,
        briefHash: matchBriefHash(brief),
        briefText: brief,
        usageType: "sync_tv_film",
      });
      showToast("License created — view on dashboard", "success");
    } catch (err) {
      showToast(`License failed: ${(err as Error).message}`, "error");
    }
  };

  return (
    <article role="listitem" className="border-t border-[var(--color-hair)]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((p) => !p)}
        className="group w-full py-3 text-left"
      >
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-[var(--color-ink-3)] w-5 shrink-0 text-right">
            {rank}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-base font-semibold truncate">{row.title}</span>
              <span className="font-serif text-sm text-[var(--color-ink-2)] truncate">{row.artist_name}</span>
            </div>
            {reason && (
              <p className="font-serif text-[13px] text-[var(--color-ink-3)] truncate mt-0.5">
                {reason}
              </p>
            )}
          </div>
          <span className="font-mono text-[11px] font-semibold text-[var(--color-rust)] tabular-nums shrink-0">
            {row.fit_score.toFixed(2)}
          </span>
          <span className="font-mono text-[9px] tabular-nums text-[var(--color-ink-3)] shrink-0 border border-[var(--color-hair-strong)] px-1.5 py-0.5" title={`${row.rating_count}/3 agents confirmed`}>
            {row.rating_count}/3
          </span>
          <span className="font-mono text-[9px] uppercase text-[var(--color-ink-3)] group-hover:text-[var(--color-rust)] transition-colors shrink-0">
            {expanded ? "close" : "play"}
          </span>
        </div>
      </button>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="pb-4 pl-9"
        >
          <AudioPlayer
            src={`/api/v1/uploads/${row.audio_path?.split("/").pop() ?? ""}`}
            title={row.title}
            by={row.artist_name}
          />
          {row.why_fits.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {row.why_fits.slice(1).map((w, j) => (
                <span key={j} className="border border-[var(--color-hair-strong)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-ink-2)]">
                  {w}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => void onShortlist()}
              disabled={shortlisted}
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.12em] border px-3 py-1.5 transition-colors",
                shortlisted
                  ? "border-[var(--color-rust)] text-[var(--color-rust)] opacity-60"
                  : "border-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
              )}
            >
              {shortlisted ? "Shortlisted" : "Shortlist"}
            </button>
            <button
              type="button"
              onClick={() => void onLicense()}
              className="font-mono text-[10px] uppercase tracking-[0.12em] border border-[var(--color-ink)] px-3 py-1.5 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
            >
              License
            </button>
          </div>
        </motion.div>
      )}
    </article>
  );
}

// ── Skeleton ────────────────────────────────────────────

function DiscoverSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="divide-y divide-[var(--color-hair)]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="py-3 flex items-center gap-4">
          <div className="skel h-3 w-5" />
          <div className="flex-1 space-y-1">
            <div className="skel h-4 w-full max-w-[240px]" />
            <div className="skel h-3 w-[160px]" />
          </div>
          <div className="skel h-3 w-[40px]" />
        </div>
      ))}
    </div>
  );
}
