"use client";

// MODULAR: Discover view — A&R agent playlists + per-play economy.
// Playlists are loaded from the API; each card lists tracks with a
// per-play payout indicator. Clicking the play button hits the
// /api/v1/ar/play endpoint to settle the $0.0005 USDC payment.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useSearchParams, useRouter } from "next/navigation";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { useToast } from "@/components/ui/Toast";
import { apiClient, type Playlist, type ListenerBadgeResponse, type BriefSearchResponse, type BriefSearchRow, type LicenseUsageType } from "@/lib/api-client";
import { parseMoodTags } from "@/lib/format";
import { energyToNumber, tempoToNumber, valenceToNumber } from "@/lib/snap";
import { deriveValence } from "@/services/taste-graph";
import { cn } from "@/lib/utils";
import { matchBriefHash } from "@/lib/match-benchmark";
import { track } from "@/lib/analytics";
import { useTypewriter } from "@/lib/use-typewriter";
import { reasoningRevealMode } from "@/lib/playlist-reasoning-ui";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { ListenerHub } from "@/components/listener/ListenerHub";

// MODULAR: refinement chips turn a one-shot brief search into a back-and-forth
// with the agents. Each option appends a plain-English constraint to the
// effective brief and re-dispatches the inverse search (agentic conversation).
const BRIEF_REFINEMENTS = [
  { id: "no-vocals", label: "no vocals", instruction: "no vocals, instrumental" },
  { id: "darker", label: "darker mood", instruction: "darker mood, less bright" },
  { id: "faster", label: "faster tempo", instruction: "faster tempo" },
  { id: "acoustic", label: "more acoustic", instruction: "more acoustic-leaning" },
  { id: "electronic", label: "more electronic", instruction: "more electronic-leaning" },
  { id: "raw", label: "raw / lo-fi", instruction: "raw, unpolished feel" },
] as const;

export function DiscoverView() {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newBadges, setNewBadges] = useState<ListenerBadgeResponse[]>([]);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiClient.getPlaylists();
      setPlaylists(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast(`Playlists load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // MODULAR: SSE keeps a second tab live when the A&R agent regenerates
  // playlists elsewhere. The event carries the fresh playlist ids so
  // only those cards auto-expand and typewrite their rationale. Refs
  // keep the EventSource stable across re-renders (FeedView pattern).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("playlist-update", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent).data) as {
            playlists?: Array<{ id: string }>;
          };
          const ids = (data.playlists ?? []).map((p) => p.id);
          if (ids.length > 0) setFreshIds(new Set(ids));
        } catch {
          // Malformed payload — still refresh below.
        }
        void refreshRef.current();
      });

      es.addEventListener("error", () => {
        track("sse_reconnect", { target: "discover" });
        es?.close();
        reconnectTimer = setTimeout(() => {
          connect();
        }, 3000);
      });
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await apiClient.generatePlaylists();
      showToast(
        `Generated ${result.generated} playlist${result.generated === 1 ? "" : "s"}`,
        "success",
      );
      await refresh();
    } catch (err) {
      showToast(`Generate failed: ${(err as Error).message}`, "error");
    } finally {
      setGenerating(false);
    }
  }, [refresh, showToast]);

  return (
    <>
      <ListenerHub />

      <MatchSearch />

      {newBadges.length > 0 && (
        <NewBadgeToast badges={newBadges} onDismiss={() => setNewBadges([])} />
      )}

      {playlists.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-12">
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={generating}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate playlists"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      )}
      {playlists.length === 0 && !loading && (
        <div className="mb-12">
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Retry loading playlists"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
          >
            <span aria-hidden="true">↻ </span>Retry loading
          </button>
        </div>
      )}

      {loading && playlists.length === 0 ? (
        <DiscoverSkeleton count={2} />
      ) : playlists.length === 0 ? (
        <DiscoverEmptyState
          generating={generating}
          onGenerate={() => void onGenerate()}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {playlists.map((pl) => (
            <PlaylistCard
              key={pl.id}
              playlist={pl}
              fresh={freshIds.has(pl.id)}
              listenerWallet={address}
              isConnected={isConnected}
              onNewBadges={(badges) => setNewBadges((prev) => [...prev, ...badges])}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PlaylistCard({
  playlist,
  fresh,
  listenerWallet,
  isConnected,
  onNewBadges,
}: {
  playlist: Playlist;
  fresh: boolean;
  listenerWallet: string | undefined;
  isConnected: boolean;
  onNewBadges?: (badges: ListenerBadgeResponse[]) => void;
}) {
  const { showToast } = useToast();
  const [payingId, setPayingId] = useState<string | null>(null);
  const [freePlay, setFreePlay] = useState(false);
  // Per-play settlement beat: which row just confirmed an on-chain pay.
  const [settledId, setSettledId] = useState<string | null>(null);

  const onPlay = useCallback(
    async (versionId: string) => {
      setPayingId(versionId);
      setSettledId(null);
      track("play_click", { versionId, playlistId: playlist.id, connected: isConnected });
      try {
        const wallet = listenerWallet ?? `anonymous_listener_${Date.now()}`;
        const resp = await apiClient.play({ playlistId: playlist.id, versionId, listenerWallet: wallet });

        if (resp.play_type === "free") {
          showToast(
            `Free play — artist paid $0.0005 (${resp.free_plays_remaining} free plays left)`,
            "success",
            4000,
          );
          setFreePlay(true);
        } else {
          setSettledId(versionId);
          showToast("Play settled — $0.0005 paid to artist on Arc", "success", 4000);
        }

        track("play_success", { versionId, playType: resp.play_type, freePlaysRemaining: resp.free_plays_remaining });
        // Show new badges via toast
        if (resp.new_badges && resp.new_badges.length > 0) {
          onNewBadges?.(resp.new_badges);
          // Also sync to ListenerHub via window bridge
          const win = window as unknown as Record<string, unknown>;
          const syncFn = win.__listenerSyncNewBadges as ((badges: ListenerBadgeResponse[]) => void) | undefined;
          syncFn?.(resp.new_badges);
          const fetchFn = win.__listenerFetchProfile as (() => void) | undefined;
          fetchFn?.();
        }
      } catch (err) {
        track("play_failed", { versionId, error: (err as Error).message.slice(0, 120) });
        showToast(`Play failed: ${(err as Error).message}`, "error");
      } finally {
        setTimeout(() => {
          setPayingId(null);
          setFreePlay(false);
        }, 1200);
        setTimeout(() => setSettledId(null), 2600);
      }
    },
    [listenerWallet, playlist.id, showToast],
  );

  return (
    <article className="border-t border-[var(--color-hair-strong)] pt-6">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="font-serif text-3xl font-normal tracking-tight mb-1">{playlist.name}</h3>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
            {playlist.genre || "mixed"} · {playlist.track_count} tracks
            {playlist.mood && (
              <span className="ml-2 inline-block border border-[var(--color-ink)] px-2 py-0.5">
                {playlist.mood}
              </span>
            )}
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[var(--color-ink-3)]">Per play</span>
          <span className="text-[var(--color-rust)] font-semibold">→ artist $0.0005</span>
          <span className="text-[var(--color-ink-2)]">· A&amp;R $0.0005</span>
        </div>
      </header>
      {playlist.description && (
        <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug max-w-[60ch] mb-4">
          {playlist.description}
        </p>
      )}
      {playlist.reasoning && (
        <ReasoningDisclosure
          playlistId={playlist.id}
          reasoning={playlist.reasoning}
          fresh={fresh}
        />
      )}
      <ul className="border-t border-[var(--color-hair)]">
        {(playlist.tracks ?? []).map((t, i) => {
          const audioUrl = `/api/v1/uploads/${t.audio_path?.split("/").pop() ?? ""}`;
          // MODULAR: parseMoodTags (lib/format) handles BOTH wire shapes
          // (the api-client declares `string | null`; Drizzle's jsonb
          // round-trip sometimes hands back a JS array) and falls back
          // to [] on malformed input. Shared with FeedView so the
          // envelope has one source of truth. Per-row call -- not
          // wrapped in useMemo because the .map body is a loop.
          const tagsArr = parseMoodTags(t.aggregated_mood_tags);
          const valence = deriveValence(tagsArr);
          return (
            <motion.li
              key={t.submission_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1], delay: Math.min(i * 0.08, 0.6) }}
              className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-[var(--color-hair)]"
            >
              <div className="flex-1 min-w-0">
                <AudioPlayer src={audioUrl} title={t.title} by={t.artist_name} />
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1 ml-12">
                  {t.version_type} · solo {(t.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
                  {(t.avg_vocal_quality ?? 0).toFixed(1)} · {valence ?? "-"}
                </div>
                {/* MODULAR: 5-axis radar nests inside the meta column --
                    a thin row below the meta pill text so it sits with
                    the audio context rather than competing for the row's
                    horizontal space against the Play button. size=50
                    keeps the radar in the "signal indicator" register
                    rather than a primary view; same deriveValence ->
                    valenceToNumber + energyToNumber + tempoToNumber chain
                    as FeedView/AgentMonitor/ArtistDashboard -- when
                    consensus is null, the snap helpers default to
                    "same"/"locked" (5/5 midpoint) so the polygon lands
                    on the radial centre rather than collapsing on every
                    axis. */}
                <div className="ml-12 mt-2 shrink-0">
                  <TasteGraphMini
                    values={{
                      solo: t.avg_solo_intensity ?? 0,
                      vocal: t.avg_vocal_quality ?? 0,
                      energy: energyToNumber(t.energy_consensus),
                      tempo: tempoToNumber(t.tempo_consensus),
                      valence: valenceToNumber(valence ?? "neutral"),
                    }}
                    size={50}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onPlay(t.submission_id)}
                disabled={payingId === t.submission_id}
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.1em] border px-2.5 py-1.5 transition-[transform,colors] duration-150 ease-out active:scale-[0.97]",
                  payingId === t.submission_id
                    ? "border-[var(--color-hair-strong)] text-[var(--color-ink-3)] cursor-wait"
                    : settledId === t.submission_id
                      ? "border-[var(--color-rust)] bg-[var(--color-rust)] text-[var(--color-paper)]"
                      : freePlay
                        ? "border-[var(--color-hair-strong)] text-[var(--color-ink-3)]"
                        : "border-[var(--color-rust)] text-[var(--color-rust)] hover:bg-[var(--color-rust)] hover:text-[var(--color-paper)]",
                )}
                title={
                  isConnected
                    ? "Artist receives $0.0005 USDC — first 10 plays free daily"
                    : "Connect a wallet to be the listener of record"
                }
              >
                {payingId === t.submission_id
                  ? "Settling…"
                  : settledId === t.submission_id
                    ? "⛓ $0.0005 settled"
                    : freePlay
                      ? "Played ✓"
                      : "→ Play"}
              </button>
            </motion.li>
          );
        })}
      </ul>
    </article>
  );
}

// ── A&R Rationale ───────────────────────────────────────
// MODULAR: same reasoning-transparency register as AgentMonitor's
// verdict cards — mono eyebrow + serif body + pulsing rust cursor.
// The typewriter fires once per card per session (fresh arrival via
// generate/SSE auto-expands; otherwise first manual expand); later
// toggles show the text instantly. Reveal decision lives in the pure
// reasoningRevealMode helper so it stays unit-testable.
function ReasoningDisclosure({
  playlistId,
  reasoning,
  fresh,
}: {
  playlistId: string;
  reasoning: string;
  fresh: boolean;
}) {
  const [expanded, setExpanded] = useState(fresh);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    if (fresh) setExpanded(true);
  }, [fresh]);

  const mode = reasoningRevealMode({ expanded, played });
  const { display, done } = useTypewriter(reasoning, {
    enabled: mode === "typewriter",
    onDone: () => setPlayed(true),
  });
  const typing = mode === "typewriter" && !done;

  return (
    <div className="mb-4">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((prev) => !prev);
          if (!expanded) track("ar_rationale_expand", { playlistId });
        }}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] hover:text-[var(--color-rust-dark)] transition-colors"
      >
        <span aria-hidden="true" className="inline-block w-3">
          {expanded ? "▾" : "▸"}
        </span>
        A&amp;R rationale
      </button>
      {expanded && (
        <p className="font-serif text-sm text-[var(--color-ink-2)] leading-snug max-w-[60ch] mt-2 border-l border-[var(--color-hair-strong)] pl-3">
          {mode === "typewriter" ? display : reasoning}
          {typing && (
            <span aria-hidden="true" className="text-[var(--color-rust)] animate-pulse">
              ▌
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ── Match by Brief (Supervisor inverse-search) ──────────
// MODULAR: the supervisor surface inverts the feed model. The user
// pastes a brief — described in plain English — and we rank every
// published track against (scene_tags, instruments, emotional_arcs,
// audience_summary) on placement_briefs. The result card carries the
// fit_score together with `why_fits` citations so a reviewer can see
// the match rationale without re-reading the source brief. Wired via
// apiClient.searchByBrief → /api/v1/discover/brief. Same cached()
// pattern as feed.ts for read-side bursts.

function MatchSearch() {
  const { showToast } = useToast();
  // Contextual sign-in nudge: the wallet is an upgrade at the point of a
  // paying action, not the front door. Guests search freely either way.
  const { isConnected: walletConnected } = useAccount();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingBrief, setSavingBrief] = useState(false);
  const [results, setResults] = useState<BriefSearchResponse | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Ground-truth: which results a supervisor has already labeled.
  const [feedbackSent, setFeedbackSent] = useState<Record<string, "good_fit" | "wrong_fit">>({});
  // License action: chosen usage type + which takes have an opened license.
  const [licenseUsage, setLicenseUsage] = useState<LicenseUsageType>("sync_tv_film");
  const [licensedFor, setLicensedFor] = useState<Record<string, boolean>>({});
  // Progressive disclosure: which result cards are expanded (reveal details/play).
  const [expandedMatch, setExpandedMatch] = useState<Record<string, boolean>>({});
  // Agentic refinement: plain-English constraints appended to re-dispatch.
  const [refinements, setRefinements] = useState<string[]>([]);

  // Pre-fill brief from ?brief= query param (e.g. from saved briefs / recent searches)
  useEffect(() => {
    const fromUrl = searchParams.get("brief");
    if (fromUrl) {
      setBrief(fromUrl);
    }
  }, [searchParams]);

  // MODULAR: single search entry point shared by the Match button,
  // the auto-search effect, and the example-brief quick-fill chips.
  // No wallet gate: guests search + log via the x-supervisor-guest
  // identity, wallet users via their session.
  const runSearch = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      showToast(`Brief must be 3–500 characters (got ${trimmed.length}).`, "error");
      return;
    }
    setLoading(true);
    setSubmitAttempted(true);
    track("brief_search", { len: trimmed.length });
    try {
      const res = await apiClient.searchByBrief({ brief: trimmed, limit: 20 });
      setResults(res);
      if (res.rows.length === 0) {
        showToast("No matches yet — try a less specific brief.", "info");
      }
      // Log search for supervisor dashboard (best-effort; no await).
      void apiClient.logSearch({ briefText: trimmed, resultsCount: res.total }).catch(() => {
        // ignore — dashboard is optional
      });
    } catch (err) {
      showToast(`Search failed: ${(err as Error).message}`, "error");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const onSearch = useCallback(() => {
    void runSearch(brief);
  }, [brief, runSearch]);

  // Auto-search if brief was pre-filled from URL
  useEffect(() => {
    if (brief.trim().length >= 3 && !submitAttempted && !results) {
      void runSearch(brief);
    }
  }, [brief, runSearch, submitAttempted, results]);

  const onInterest = async (row: BriefSearchRow) => {
    try {
      await apiClient.addInterest({ submissionId: row.submission_id });
      showToast("Added to your licensing shortlist", "success");
    } catch (err) {
      showToast(`Interest failed: ${(err as Error).message}`, "error");
    }
  };

  // MODULAR: record ground-truth (good_fit / wrong_fit) for the shown
  // (brief → take) match. brief_hash buckets the query so the benchmark can
  // aggregate across supervisors; rank is the 1-based display position.
  const onFeedback = async (row: BriefSearchRow, rank: number, verdict: "good_fit" | "wrong_fit") => {
    try {
      await apiClient.recordMatchFeedback({
        briefHash: matchBriefHash(brief),
        briefText: brief,
        submissionId: row.submission_id,
        fitScoreShown: row.fit_score,
        rankShown: rank,
        verdict,
      });
      setFeedbackSent((prev) => ({ ...prev, [row.submission_id]: verdict }));
      showToast(verdict === "good_fit" ? "Good fit — logged to the benchmark" : "Wrong fit — logged to the benchmark", "success");
    } catch (err) {
      showToast(`Feedback failed: ${(err as Error).message}`, "error");
    }
  };

  // MODULAR: open a license for a matched take. The price is derived
  // server-side from usage_type; the supervisor settles it on the dashboard.
  const onLicense = async (row: BriefSearchRow) => {
    try {
      await apiClient.createLicense({
        submissionId: row.submission_id,
        briefHash: matchBriefHash(brief),
        briefText: brief,
        usageType: licenseUsage,
      });
      setLicensedFor((prev) => ({ ...prev, [row.submission_id]: true }));
      showToast("License created — settle it on your dashboard", "success");
    } catch (err) {
      showToast(`License failed: ${(err as Error).message}`, "error");
    }
  };

  const onSaveBrief = async () => {
    const trimmed = brief.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      showToast(`Brief must be 3–500 characters (got ${trimmed.length}).`, "error");
      return;
    }
    setSavingBrief(true);
    try {
      await apiClient.saveBrief({ briefText: trimmed });
      showToast("Brief saved — redirecting to dashboard", "success");
      router.push("/supervisor");
    } catch (err) {
      showToast(`Save brief failed: ${(err as Error).message}`, "error");
    } finally {
      setSavingBrief(false);
    }
  };

  // Agentic refinement: append a constraint to the effective brief and
  // re-dispatch the inverse search so the user talks to the agents.
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
  const resetRefinements = useCallback(() => {
    setRefinements([]);
    void runSearch(brief);
  }, [brief, runSearch]);

  return (
    <section
      aria-labelledby="match-brief-heading"
      className="mb-16 border-t border-[var(--color-hair-strong)] pt-8"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-2">
        For supervisors &amp; A&amp;R
      </p>
      <h3
        id="match-brief-heading"
        className="font-serif text-2xl md:text-3xl font-black tracking-tight mb-3"
      >
        Describe the scene. Find the track.
      </h3>
      <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug max-w-2xl mb-5">
        Paste a brief in plain English. No wallet needed — search is free. We rank
        the top 20 versions by fit.
      </p>
      <div className="flex flex-col gap-3 max-w-2xl">
        <label
          htmlFor="brief-input"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]"
        >
          Brief
        </label>
        <textarea
          id="brief-input"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={'e.g. "tense car chase, no vocals, ~120bpm, building to release at 1:30"'}
          rows={3}
          maxLength={500}
          aria-describedby="brief-help"
          className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-3 font-serif text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none focus:border-[var(--color-rust)] resize-vertical"
        />
        <div id="brief-help" className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            {brief.length}/500 chars
          </span>
          <button
            type="button"
            onClick={() => void onSearch()}
            disabled={loading || brief.trim().length < 3}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
          >
            {loading ? "Searching\u2026" : "Match"}
          </button>
        </div>
        <ExampleBriefChips
          onPick={(text) => {
            setBrief(text);
            void runSearch(text);
          }}
        />
      </div>
      {loading && (
        <div className="mt-6" role="status" aria-live="polite">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
            <span aria-hidden="true" className="inline-block w-3 animate-pulse text-[var(--color-rust)]">
              ●
            </span>{" "}
            Dispatching 3 agents&nbsp;· reading your brief&nbsp;· scoring every alternate take…
          </p>
          <DiscoverSkeleton count={2} />
        </div>
      )}
{results && results.rows.length > 0 && !loading && (
        <div className='mt-8' role='list' aria-label='Match results'>
          <div className='mb-4 border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-4 py-3'>
            <p className='font-serif text-base leading-snug text-[var(--color-ink)]'>
              <span className='font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)]'>Agent verdict&nbsp;·</span>{" "}
              {results.rows.length} of {results.total} alternate take{results.total === 1 ? "" : "s"} evaluated, ranked to your brief. Top pick:{" "}
              <span className='font-black'>{results.rows[0].title}</span> by {results.rows[0].artist_name} — best fit{" "}
              <span className='tabular-nums'>{results.rows[0].fit_score.toFixed(2)}</span>.
            </p>
            <div className='mt-2 flex flex-wrap gap-2'>
              <button type='button' onClick={() => void onSaveBrief()} disabled={savingBrief} className='bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50'>
                {savingBrief ? "Saving…" : "Save brief"}
              </button>
            </div>
          </div>

          <RefineStrip
            active={refinements}
            options={BRIEF_REFINEMENTS}
            onApply={applyRefinement}
            onRemove={removeRefinement}
            onReset={resetRefinements}
            disabled={loading}
          />

          {!walletConnected && (
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              guest session — sign in to settle &amp; persist · search stays free
            </p>
          )}

          {results.rows.map((r, i) => {
            const isOpen = !!expandedMatch[r.submission_id];
            const reason = r.why_fits[0] ?? r.brief.audience_summary ?? null;
            return (
              <article key={r.submission_id} role='listitem' className='border-t border-[var(--color-hair)]'>
                <button type='button' aria-expanded={isOpen} onClick={() => setExpandedMatch((p) => ({ ...p, [r.submission_id]: !isOpen }))} className='group w-full py-4 text-left'>
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='min-w-0 flex-1'>
                      <div className='font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]'>#{i + 1} match</div>
                      <div className='mt-0.5 font-serif text-xl font-black'>{r.title}</div>
                      <div className='mt-1 font-serif text-sm text-[var(--color-ink-2)]'>{r.artist_name} · {r.version_type} · {r.rating_count} ratings</div>
                      {reason && <p className='mt-2 font-serif text-sm text-[var(--color-ink-2)] leading-snug max-w-[60ch]'>{reason}</p>}
                    </div>
                    <div className='flex flex-col items-end gap-2'>
                      <span className='font-serif text-sm font-semibold text-[var(--color-rust)] tabular-nums'>fit {r.fit_score.toFixed(2)}</span>
                      <span className='font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] group-hover:text-[var(--color-rust)] transition-colors'>{isOpen ? "▲ Close" : "▶ Play & details"}</span>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className='pb-5'>
                    <AudioPlayer src={`/api/v1/uploads/${r.audio_path?.split("/").pop() ?? ""}`} title={r.title} by={r.artist_name} />
                    {r.brief.audience_summary && <p className='font-serif text-sm text-[var(--color-ink-2)] leading-snug max-w-[60ch] mt-2'>{r.brief.audience_summary}</p>}
                    {r.why_fits.length > 0 && (
                      <ul className='flex flex-wrap gap-2 mt-2' role='list' aria-label='Why this fits'>
                        {r.why_fits.map((w, j) => (<li key={j} role='listitem' className='border border-[var(--color-rust)] px-2 py-1 font-serif text-[13px] text-[var(--color-rust)]'>{w}</li>))}
                      </ul>
                    )}
                    {(r.brief.scene_tags.length > 0 || r.brief.instruments.length > 0) && <MatchProfileDisclosure sceneTags={r.brief.scene_tags} instruments={r.brief.instruments} />}
                    <div className='flex flex-wrap gap-2 mt-4'>
                      <button type='button' onClick={() => void onInterest(r)} className='bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 hover:bg-[var(--color-rust)] transition-colors'>Interested</button>
                    </div>
                    <div className='mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]'>
                      <span className='text-[var(--color-ink-3)]'>Match quality:</span>
                      <button type='button' onClick={() => void onFeedback(r, i + 1, 'good_fit')} disabled={!!feedbackSent[r.submission_id]} aria-pressed={feedbackSent[r.submission_id] === 'good_fit'} className={cn('border px-2.5 py-1 transition-colors', feedbackSent[r.submission_id] === 'good_fit' ? 'border-[var(--color-rust)] text-[var(--color-rust)]' : 'border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]', feedbackSent[r.submission_id] ? 'cursor-default opacity-60' : 'cursor-pointer')}>{feedbackSent[r.submission_id] === 'good_fit' ? '✓ Good fit' : 'Good fit'}</button>
                      <button type='button' onClick={() => void onFeedback(r, i + 1, 'wrong_fit')} disabled={!!feedbackSent[r.submission_id]} aria-pressed={feedbackSent[r.submission_id] === 'wrong_fit'} className={cn('border px-2.5 py-1 transition-colors', feedbackSent[r.submission_id] === 'wrong_fit' ? 'border-[var(--color-ink)] text-[var(--color-ink)]' : 'border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]', feedbackSent[r.submission_id] ? 'cursor-default opacity-60' : 'cursor-pointer')}>{feedbackSent[r.submission_id] === 'wrong_fit' ? '✕ Wrong fit' : 'Wrong fit'}</button>
                    </div>
                    <div className='mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]'>
                      <span className='text-[var(--color-ink-3)]'>License this take:</span>
                      <select aria-label='Usage type' value={licenseUsage} onChange={(e) => setLicenseUsage(e.target.value as LicenseUsageType)} disabled={!!licensedFor[r.submission_id]} className='border border-[var(--color-ink)] bg-[var(--color-paper)] p-1 font-mono text-[10px] uppercase tracking-[0.1em]'>
                        <option value='sync_tv_film'>TV/Film</option>
                        <option value='sync_ad'>Ad</option>
                        <option value='sync_digital'>Digital</option>
                        <option value='other'>Other</option>
                      </select>
                      <button type='button' onClick={() => void onLicense(r)} disabled={!!licensedFor[r.submission_id]} className='border border-[var(--color-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-50'>{licensedFor[r.submission_id] ? 'Licensed ✓' : 'License this take'}</button>
                    </div>
                    {r.brief.sync_comparables.length > 0 && (
                      <div className='font-mono text-[10px] mt-3 text-[var(--color-ink-3)]'>{r.brief.sync_comparables.slice(0, 2).map((c) => `\u201c${c.name}\u201d`).join(' \u00b7 ')}</div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {results && results.rows.length === 0 && !loading && submitAttempted && (
        <p className="mt-6 font-serif italic text-[var(--color-ink-3)] border-t border-b border-[var(--color-hair)] py-8 text-center">
          No tracks matched that brief yet. Try a less specific language.
        </p>
      )}
    </section>
  );
}

// ── Example brief quick-fill ────────────────────────────
// MODULAR: one-click chips so a cold visitor can try the
// inverse-search with zero typing. Each brief is tuned to score
// against at least one seeded placement brief (see
// src/lib/example-briefs.ts).
function ExampleBriefChips({ onPick }: { onPick: (brief: string) => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Try an example brief"
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        Try:
      </span>
      {EXAMPLE_BRIEFS.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onPick(e.brief)}
          className="border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}

// ── Agentic refinement strip ──────────────────────────
// MODULAR: suggests plain-English constraints that re-dispatch the inverse
// search, turning a one-shot query into a conversation with the agents.
// Active constraints are shown as removable chips; Reset clears them.
function RefineStrip({
  active,
  options,
  onApply,
  onRemove,
  onReset,
  disabled,
}: {
  active: string[];
  options: ReadonlyArray<{ id: string; label: string; instruction: string }>;
  onApply: (instruction: string) => void;
  onRemove: (instruction: string) => void;
  onReset: () => void;
  disabled: boolean;
}) {
  const available = options.filter((o) => !active.includes(o.instruction));
  return (
    <div className="mb-4" aria-label="Refine this brief">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        Refine the brief →
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {active.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1.5 border border-[var(--color-rust)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-rust)]"
          >
            {a}
            <button
              type="button"
              onClick={() => onRemove(a)}
              disabled={disabled}
              aria-label={`Remove: ${a}`}
              className="leading-none hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {available.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onApply(o.instruction)}
            disabled={disabled}
            className="border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-40"
          >
            + {o.label}
          </button>
        ))}
        {active.length > 0 && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className="border border-[var(--color-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-40"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ── Progressive disclosure: per-track profile ──────────
// MODULAR: scene tags + instruments stay collapsed behind one
// toggle so the result card leads with the match rationale
// (why_fits) and playback, not a wall of chips.
function MatchProfileDisclosure({
  sceneTags,
  instruments,
}: {
  sceneTags: string[];
  instruments: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        aria-expanded={expanded}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
      >
        <span aria-hidden="true" className="inline-block w-3">
          {expanded ? "▾" : "▸"}
        </span>
        Track profile
      </button>
      {expanded && (
        <div className="flex flex-wrap gap-2 mt-2">
          {sceneTags.map((tag, i) => (
            <span
              key={`tag-${i}`}
              className="bg-[var(--color-paper-2)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink)]"
            >
              {tag}
            </span>
          ))}
          {instruments.map((inst, i) => (
            <span
              key={`inst-${i}`}
              className="border border-[var(--color-hair-strong)] px-2 py-1 font-mono text-[10px] tracking-wide text-[var(--color-ink-2)]"
            >
              {inst}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────

interface FeaturedQuote {
  id: string;
  text: string;
  by: string;
  role: string;
}

const FALLBACK_DISCOVER_QUOTE: FeaturedQuote = {
  id: "fallback",
  text: "Taste isn't a vote. It's a small, daily bet.",
  by: "house rule",
  role: "taste maker",
};

function DiscoverEmptyState({
  generating,
  onGenerate,
}: {
  generating: boolean;
  onGenerate: () => void;
}) {
  const [quote, setQuote] = useState<FeaturedQuote>(FALLBACK_DISCOVER_QUOTE);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/featured-quotes.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((list: FeaturedQuote[] | null) => {
        if (cancelled) return;
        if (Array.isArray(list) && list.length > 0) {
          setQuote(list[Math.floor(Math.random() * list.length)]);
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="border-t border-b border-[var(--color-hair)] py-12 font-serif text-[var(--color-ink-2)]">
      <div className="grid md:grid-cols-[1fr_auto] gap-8 items-start">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-3">
            The catalog is quiet
          </p>
          <h3 className="font-serif text-3xl md:text-4xl font-black tracking-tight mb-3 text-[var(--color-ink)]">
            No playlists yet.
          </h3>
          <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug max-w-[60ch] mb-2">
            Once a few submissions publish, the A&amp;R agent reads the
            catalog, clusters it by genre and mood, and writes a curated
            set. Each play pays the artist directly &mdash; no algorithm
            gatekeepers.
          </p>
          <div
            role="group"
            aria-label="Get started"
            className="flex flex-wrap gap-3 mt-4"
          >
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate playlists →"}
            </button>
            <a
              href="/submit"
              className="border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
            >
              Submit a version
            </a>
            <a
              href="/agents"
              className="font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 text-[var(--color-ink-2)] hover:text-[var(--color-rust)] transition-colors"
            >
              How curation works →
            </a>
          </div>
        </div>
        <aside className="md:max-w-[36ch] md:border-l md:border-[var(--color-hair-strong)] md:pl-6">
          <blockquote>
            <p className="font-serif italic text-[20px] leading-[1.45] text-[var(--color-ink)] mb-3">
              &ldquo;{quote.text}&rdquo;
            </p>
            <footer className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
              — <cite className="not-italic text-[var(--color-ink)] font-medium">{quote.by}</cite>
              <span className="ml-2 text-[var(--color-ink-2)]">{quote.role}</span>
            </footer>
          </blockquote>
        </aside>
      </div>
    </div>
  );
}

// ── New Badge Toast ─────────────────────────────────────

function NewBadgeToast({
  badges,
  onDismiss,
}: {
  badges: ListenerBadgeResponse[];
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 max-w-sm bg-[var(--color-ink)] text-[var(--color-paper)] p-5 rounded shadow-xl transition-all duration-300",
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-2 pointer-events-none",
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)]">
          New badge{badges.length > 1 ? "s" : ""} earned!
        </span>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="font-mono text-[11px] text-[var(--color-ink-3)] hover:text-[var(--color-paper)] transition-colors"
        >
          ×
        </button>
      </div>
      <div className="flex gap-3 items-center">
        {badges.map((b) => (
          <div key={b.id} className="flex flex-col items-center gap-1">
            <span className="text-2xl">{b.icon}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] whitespace-nowrap">
              {b.label}
            </span>
          </div>
        ))}
      </div>
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-2)] mt-2">
        {badges.length === 1 ? "Check your profile to see all your badges" : "Keep listening to earn more badges"}
      </p>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────

function DiscoverSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-8">
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="border-t border-[var(--color-hair-strong)] pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
            <div className="space-y-2 flex-1">
              <div className="skel h-[28px] w-full max-w-[300px]" />
              <div className="skel h-[12px] w-[180px]" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="skel h-[10px] w-[50px]" />
              <div className="skel h-[10px] w-[90px]" />
              <div className="skel h-[10px] w-[70px]" />
            </div>
          </div>
          <div className="skel h-[16px] w-full max-w-[420px] mb-4" />
          <div className="border-t border-[var(--color-hair)]">
            {Array.from({ length: 3 }).map((_, j) => (
              <div
                key={j}
                className="flex items-center justify-between gap-3 py-3 border-b border-[var(--color-hair)]"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="skel h-8 w-8 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skel h-[10px] w-full max-w-[240px]" />
                    <div className="skel h-[10px] w-[140px]" />
                  </div>
                </div>
                <div className="skel h-[24px] w-[100px] shrink-0" />
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
