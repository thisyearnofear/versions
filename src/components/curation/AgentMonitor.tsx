"use client";

// MODULAR: Agent monitor dashboard. Replaces the human-curation
// CurateConsole. Shows the submission queue with live agent review
// summaries — no wallet connection, no claim/rate flow. The AI
// agents (Production, Performance, Market) handle everything
// autonomously; this is a read-only window into their activity.
// SSE keeps the queue fresh in real time.
//
// MODULAR: the dashboard also surfaces the LOOP'S TAIL (recently-
// published versions) in a top strip, wired off the SAME SSE effect
// that drives queue updates. Judges see the submit → review → settle
// → publish lifecycle complete in one glance without scrolling.
// LIVE badge piggybacks off EventSource lifecycle (open/close) —
// no parallel health probe, no separate heartbeat timer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { PipelineStepper } from "@/components/economy/PipelineStepper";
import { apiClient, type AgentReviewRecord, type FeedRow, type QueueSubmission } from "@/lib/api-client";
import type { AgentStreamEvent } from "@/lib/event-bus";
import { useTypewriter } from "@/lib/use-typewriter";
import { parseMoodTags } from "@/lib/format";
import { energyToNumber, tempoToNumber, valenceToNumber } from "@/lib/snap";
import { deriveValence } from "@/services/taste-graph";
import { escapeHtml } from "@/lib/utils";
import { isSoundEnabled, playPublishFanfare } from "@/lib/audio-feedback";
import DOMPurify from "dompurify";

// ── Agent identity kit ─────────────────────────────────

// MODULAR: each agent exposes a one-line `focus` — the specific rubric it
// weighs. It is rendered on every verdict card so the three agents read as
// genuinely distinct reviewers (mix/mastering vs delivery vs placement
// recall) rather than the same model asked three times. The real system
// prompts already differ (services/agents.ts); this surfaces that intent.
interface AgentMeta {
  icon: string;
  label: string;
  focus: string;
  color: string;
}

const AGENT_META: Record<string, AgentMeta> = {
  production: {
    icon: "🎛️",
    label: "Production Agent",
    focus: "Mix · mastering · technical sound",
    color: "var(--color-rust)",
  },
  performance: {
    icon: "🎤",
    label: "Performance Agent",
    focus: "Delivery · feel · emotional impact",
    color: "var(--color-ink)",
  },
  market: {
    icon: "📊",
    label: "Market Agent",
    focus: "Placement fit · inverse-search recall",
    color: "var(--color-ink-2)",
  },
};

const FALLBACK_AGENT_META: AgentMeta = {
  icon: "🤖",
  label: "Agent",
  focus: "Autonomous review",
  color: "var(--color-ink)",
};

// ── Component ───────────────────────────────────────────

type SseStatus = "connecting" | "live" | "reconnecting";
// MODULAR: post-`loadRecentVerdicts` filter predicate narrows each
// row to one with a non-null published_at — naming the narrowed
// shape once so the useState type + the JSX .published_at call site
// agree. Previously typed as FeedRow[] which produced the compile
// error `string | null | undefined is not assignable to string` when
// humanRelativeTime(r.published_at) was called from JSX.
type PublishedRow = FeedRow & { published_at: string };

// ── Streaming session state ─────────────────────────────
// Populated by `agent-stream` SSE events while a review is in flight.
// Cards reveal sequentially (production → performance → market) via a
// revealCursor; the consensus banner lands once all three are done.

const STREAM_AGENT_ORDER = ["production", "performance", "market"] as const;

interface StreamAgentState {
  phase: "thinking" | "verdict" | "failed";
  verdict?: AgentReviewRecord;
}

interface ConsensusState {
  ratingCount: number;
  published: boolean;
  avgSolo: number | null;
  avgVocal: number | null;
  mock: boolean;
}

interface StreamSession {
  submissionId: string;
  agents: Partial<Record<string, StreamAgentState>>;
  consensus?: ConsensusState;
}

export function AgentMonitor() {
  const [queue, setQueue] = useState<QueueSubmission[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<AgentReviewRecord[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  // MODULAR: surface the loop's tail-end output (recently-published
  // versions) at the top of the monitor so judges see agent
  // decisions → publish leg in one glance. Reuses getFeed() (no new
  // endpoint). sseStatus piggybacks off the existing EventSource
  // open/error lifecycle — no parallel reconnect machinery needed.
  const [recentVerdicts, setRecentVerdicts] = useState<PublishedRow[]>([]);
  const [sseStatus, setSseStatus] = useState<SseStatus>("connecting");
  // Live streaming session (agent-stream SSE). Last-writer-wins: a new
  // submissionId replaces the session. revealCursor sequences the
  // typewriter reveals in STREAM_AGENT_ORDER.
  const [stream, setStream] = useState<StreamSession | null>(null);
  const [revealCursor, setRevealCursor] = useState(0);
  const streamSubRef = useRef<string | null>(null);

  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const rows = await apiClient.getQueue(50);
      setQueue(Array.isArray(rows) ? rows : []);
    } catch (err) {
      // Silent — queue refresh is background; log for debugging.
      console.debug('[agent-monitor] queue refresh failed:', (err as Error).message);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  // MODULAR: loadRecentVerdicts pulls the 3 most recently-published
  // versions from getFeed() — the publish-leg of the agent loop is
  // the trace that surfaces the monitor's value to judges. Filter
  // client-side instead of a separate endpoint because getFeed
  // already orders by published_at DESC and the publishedVersions
  // table is bounded (one row per submission, never deleted).
  const loadRecentVerdicts = useCallback(async () => {
    try {
      const { rows } = await apiClient.getFeed({ limit: 25 });
      const published = (Array.isArray(rows) ? rows : [])
        .filter((r): r is FeedRow & { published_at: string } => Boolean(r.published_at))
        .sort((a, b) => (b.published_at > a.published_at ? 1 : -1))
        .slice(0, 3);
      setRecentVerdicts(published);
    } catch {
      // Silent — same rationale as queue refresh: background call.
    }
  }, []);

  // Initial load — both queue AND verdicts refresh in parallel
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshQueue();
    void loadRecentVerdicts();
  }, [refreshQueue, loadRecentVerdicts]);

  // MODULAR: refreshQueueRef + loadRecentVerdictsRef mirror the
  // existing pattern so the SSE handler (effectively an outer-scope
  // closure) reads the LATEST callbacks without forcing the SSE
  // effect to re-subscribe on every callback identity change.
  const refreshQueueRef = useRef(refreshQueue);
  const loadRecentVerdictsRef = useRef(loadRecentVerdicts);
  useEffect(() => {
    refreshQueueRef.current = refreshQueue;
    loadRecentVerdictsRef.current = loadRecentVerdicts;
  }, [refreshQueue, loadRecentVerdicts]);

  // SSE — keep queue live + track connection status + auto-refresh
  // the recent-verdicts strip when a queue-update arrives (because
  // publishing ≈ a queue-update with the version landing in the
  // published_versions table in the same transaction window).
  // Also listens to economy-event so an agent verdict landing on the
  // currently-selected submission refreshes the review pane instantly
  // — the judge sees the card appear while they are watching.
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      setSseStatus("connecting");
      es = new EventSource("/api/events");
      es.addEventListener("open", () => {
        // MODULAR: EventSource emits "open" once when the SSE
        // handshake completes. We mark live from that point; any
        // subsequent error event flips to reconnecting so judges
        // see the badge change in real time without a parallel
        // health probe.
        setSseStatus("live");
      });
      es.addEventListener("queue-update", () => {
        refreshQueueRef.current();
        // A queue-update almost certainly coincides with a publish-
        // leg landing, so refresh the recent-verdicts strip too.
        loadRecentVerdictsRef.current();
      });
      es.addEventListener("economy-event", (msg) => {
        try {
          const e = JSON.parse((msg as MessageEvent).data) as { kind?: string; submissionId?: string };
          if (e.kind === "review" && e.submissionId) {
            const sid = e.submissionId;
            setSelectedId(sid);
            apiClient.getReviews(sid).then((data) => {
              setReviews(Array.isArray(data) ? data : []);
            }).catch(() => { /* silent */ });
          }
        } catch {
          /* malformed — ignore */
        }
      });
      es.addEventListener("agent-stream", (msg) => {
        try {
          const e = JSON.parse((msg as MessageEvent).data) as AgentStreamEvent;
          if (e.type === "agent_started" && streamSubRef.current !== e.submissionId) {
            streamSubRef.current = e.submissionId;
            setRevealCursor(0);
          }
          if (e.type === "agent_started") setSelectedId(e.submissionId);
          setStream((prev) => {
            const base: StreamSession =
              prev && prev.submissionId === e.submissionId
                ? prev
                : { submissionId: e.submissionId, agents: {} };
            switch (e.type) {
              case "agent_started":
                return { ...base, agents: { ...base.agents, [e.agentName]: { phase: "thinking" as const } } };
              case "agent_verdict":
                return {
                  ...base,
                  agents: {
                    ...base.agents,
                    [e.agentName]: {
                      phase: "verdict" as const,
                      verdict: {
                        submission_id: e.submissionId,
                        agent_name: e.agentName as AgentReviewRecord["agent_name"],
                        notes: e.notes,
                        mood_tags: e.moodTags,
                        solo_intensity: e.solo,
                        vocal_quality: e.vocal,
                        energy_vs_studio: e.energy as AgentReviewRecord["energy_vs_studio"],
                        tempo_feel: e.tempo as AgentReviewRecord["tempo_feel"],
                        detail: e.detail ?? null,
                        fit_score: e.fitScore ?? null,
                        mock: e.mock,
                      },
                    },
                  },
                };
              case "agent_failed":
                return { ...base, agents: { ...base.agents, [e.agentName]: { phase: "failed" as const } } };
              case "consensus":
                return {
                  ...base,
                  consensus: {
                    ratingCount: e.ratingCount,
                    published: e.published,
                    avgSolo: e.avgSolo,
                    avgVocal: e.avgVocal,
                    mock: e.mock,
                  },
                };
            }
            return base;
          });
          if (e.type === "consensus") {
            // MODULAR: celebration moment — when the 3rd verdict lands
            // and the track publishes, play the fanfare (respecting the
            // ♪ sound toggle) so the judge hears the win, not just reads
            // it. Deliberately OUTSIDE the setStream updater so the side
            // effect stays pure w.r.t. React (updaters can be invoked
            // twice in StrictMode dev, which would double-fire the sound).
            if (e.published && isSoundEnabled()) playPublishFanfare();
            apiClient.getReviews(e.submissionId).then((data) => {
              setReviews(Array.isArray(data) ? data : []);
            }).catch(() => { /* silent */ });
            loadRecentVerdictsRef.current();
          }
        } catch {
          /* malformed — ignore */
        }
      });
      es.addEventListener("error", () => {
        setSseStatus("reconnecting");
        es?.close();
        reconnectTimer = setTimeout(() => connect(), 3000);
      });
    }

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  // Select a submission → fetch agent reviews
  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    setReviewsLoading(true);
    try {
      const data = await apiClient.getReviews(id);
      setReviews(Array.isArray(data) ? data : []);
    } catch {
      setReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  const streamActive = stream !== null && stream.submissionId === selectedId;
  const streamedVerdictCount = streamActive && stream
    ? Object.values(stream.agents).filter((a) => a?.phase === "verdict").length
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-[var(--color-hair-strong)] pt-8">
      {/* Recent Verdicts strip — full-width above the queue/reviews grid */}
      <section className="md:col-span-2 mb-2" aria-live="polite">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-serif text-xl font-black">Recent Verdicts</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            Last 3 published · live
          </span>
        </div>
        {recentVerdicts.length === 0 ? (
          <div className="font-serif italic text-[var(--color-ink-3)] py-6 border-t border-b border-[var(--color-hair)] text-center">
            No published versions yet.
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] mt-2">
              The first agent-reviewed + auto-published loop will land here.
            </div>
          </div>
        ) : (
          <ul className="flex flex-col border-t border-[var(--color-hair)]">
            {recentVerdicts.map((r) => (
              <li
                key={r.submission_id}
                className="flex items-baseline gap-3 py-3 px-3 -mx-3 border-b border-[var(--color-hair)] hover:bg-[var(--color-paper)]/40"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[10px] leading-none mt-0.5 text-[var(--color-rust)]"
                >
                  ●
                </span>
                <span className="font-serif text-[15px] font-medium truncate">{r.title}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-2)] whitespace-nowrap">
                  · {r.artist_name}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-ink-3)] ml-auto whitespace-nowrap tabular-nums">
                  {humanRelativeTime(r.published_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Queue pane */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-serif text-2xl font-black">Queue</h3>
          <div className="flex items-baseline gap-3">
            {/* MODULAR: SSE-status badge wired off the EventSource
                lifecycle (open → live; error → reconnecting after 3 s).
                Designed to match the visual rhythm of the existing
                mono-uppercase eyebrow + colored dot to keep the
                monitor's chrome consistent. */}
            <span
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]"
              title={
                sseStatus === "live"
                  ? "SSE connected — queue & verdicts auto-refresh"
                  : sseStatus === "connecting"
                    ? "SSE handshake in progress"
                    : "SSE lost — retrying every 3s"
              }
            >
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full ${
                  sseStatus === "live"
                    ? "bg-[var(--color-rust)] animate-pulse"
                    : sseStatus === "connecting"
                      ? "bg-[var(--color-ink-3)]"
                      : "bg-[var(--color-rust-dark)] animate-pulse"
                }`}
              />
              {sseStatus === "live"
                ? "Live"
                : sseStatus === "connecting"
                  ? "Connecting"
                  : "Reconnecting"}
            </span>
            <button
              type="button"
              onClick={() => void refreshQueue()}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]"
            >
              Refresh
            </button>
          </div>
        </div>
        <ul className="flex flex-col">
          {queueLoading && queue.length === 0 ? (
            <QueueSkeleton count={6} />
          ) : queue.length === 0 ? (
            <li className="py-10 border-t border-b border-[var(--color-hair)] font-serif italic text-[var(--color-ink-3)] text-center">
              The queue is empty.
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] mt-3">
                Seed the catalog to see submissions here.
              </div>
            </li>
          ) : null}
          {queue.map((sub) => {
            const isSelected = selectedId === sub.id;
            return (
              <li
                key={sub.id}
                onClick={() => select(sub.id)}
                className={`py-4 px-3 -mx-3 cursor-pointer border-t border-[var(--color-hair)] last:border-b transition-colors ${
                  isSelected
                    ? "border-l-2 border-l-[var(--color-rust)] bg-[var(--color-paper-2)]"
                    : "border-l-2 border-l-transparent hover:bg-[var(--color-paper)]/40"
                }`}
              >
                <div className="font-serif text-[17px] font-medium">{sub.title}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                  {sub.artist_name} · {sub.version_type}
                  {sub.ratingCount !== undefined && ` · ${sub.ratingCount}/3 agents rated`}
                  {sub.status && (
                    <span
                      className={`ml-2 inline-block border px-1.5 py-px text-[9px] tracking-[0.14em] ${
                        sub.status === "in_curation"
                          ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                          : "border-[var(--color-hair-strong)] text-[var(--color-ink-3)]"
                      }`}
                    >
                      {sub.status.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Agent review pane */}
      <section>
        <h3 className="font-serif text-2xl font-black mb-4">Agent Reviews</h3>
        {selectedId && (
          <div className="mb-5 border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)]/40 px-4 py-3">
            {/* A published submission leaves the queue, so fall back to
                the loaded reviews for count/status — otherwise the
                stepper reads "0/3 agents" under three visible cards. */}
            <PipelineStepper
              status={
                queue.find((q) => q.id === selectedId)?.status ??
                (reviews.length >= 3 || (streamActive && stream?.consensus?.published)
                  ? "published"
                  : undefined)
              }
              ratingCount={Math.max(
                queue.find((q) => q.id === selectedId)?.ratingCount ?? reviews.length,
                streamedVerdictCount,
              )}
            />
          </div>
        )}
        {!selectedId ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border-t border-b border-[var(--color-hair)]">
            Select a submission from the queue to inspect agent reviews.
          </p>
        ) : streamActive && stream ? (
          <div className="flex flex-col gap-4">
            {stream.consensus && revealCursor >= 3 && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="border border-[var(--color-rust)] bg-[var(--color-paper-2)]/60 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-rust)]">
                    Consensus
                  </span>
                  {stream.consensus.published && (
                    <motion.span
                      aria-hidden="true"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: [0.5, 1.35, 1], opacity: 1 }}
                      transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
                      className="font-mono text-[9px] uppercase tracking-[0.18em] border border-[var(--color-rust)] px-1.5 py-px text-[var(--color-rust)]"
                    >
                      ● Published
                    </motion.span>
                  )}
                </div>
                <div className="font-serif text-sm">
                  {stream.consensus.ratingCount}/3 verdicts in
                  {stream.consensus.avgSolo != null && stream.consensus.avgVocal != null &&
                    ` · avg solo ${stream.consensus.avgSolo.toFixed(1)} / vocal ${stream.consensus.avgVocal.toFixed(1)}`}
                </div>
                <div className="flex items-center gap-2 mt-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                  {stream.consensus.mock && (
                    <span className="border border-[var(--color-hair-strong)] px-1.5 py-px text-[9px] text-[var(--color-ink-3)]">
                      mock
                    </span>
                  )}
                </div>
              </motion.div>
            )}
            <AnimatePresence mode="popLayout">
              {STREAM_AGENT_ORDER.map((name, idx) => {
                const st = stream.agents[name];
                const fetched = reviews.find(
                  (r) => r.agent_name === name && r.submission_id === selectedId,
                );
                if (!st && !fetched) return null;
                const meta = AGENT_META[name] ?? { ...FALLBACK_AGENT_META, label: name };
                const review = fetched ?? st?.verdict;
                return (
                  <motion.div
                    key={`${selectedId}-${name}`}
                    initial={{ opacity: 0, y: 16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {st?.phase === "failed" && !review ? (
                      <StreamFailedCard
                        meta={meta}
                        onSettled={() => setRevealCursor((c) => Math.max(c, idx + 1))}
                      />
                    ) : !review ? (
                      <AgentThinkingCard meta={meta} />
                    ) : (
                      <AgentReviewCard
                        review={review}
                        meta={meta}
                        typewriter={{
                          enabled: revealCursor >= idx,
                          onDone: () => setRevealCursor((c) => Math.max(c, idx + 1)),
                        }}
                      />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : reviewsLoading ? (
          <ReviewCardSkeleton count={3} />
        ) : reviews.length === 0 ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border-t border-b border-[var(--color-hair)]">
            Agents have not reviewed this submission yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <AnimatePresence mode="popLayout">
              {reviews.map((r, idx) => {
                const meta = AGENT_META[r.agent_name] ?? { ...FALLBACK_AGENT_META, label: r.agent_name };
                return (
                  <motion.div
                    key={`${r.submission_id}-${r.agent_name}`}
                    initial={{ opacity: 0, y: 16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: idx * 0.12, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <AgentReviewCard review={r} meta={meta} />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Agent Review Card ───────────────────────────────────

function AgentReviewCard({
  review,
  meta,
  typewriter,
}: {
  review: AgentReviewRecord;
  meta: AgentMeta;
  typewriter?: { enabled: boolean; onDone?: () => void };
}) {
  // MODULAR: parseMoodTags (lib/format) handles BOTH wire shapes
  // the api-client envelope can land as -- a JSON-stringified
  // string OR a Drizzle jsonb round-tripped JS array. The
  // previous inline Array.isArray short-circuit returned [] for
  // the string-shape branch, so the valence ScoreRow AND radar
  // landed at neutral even when the LLM had surfaced bright/dark
  // tags. Routed through the helper via the shared parser used
  // by FeedView/DiscoverView/ArtistDashboard.
  const moodTags = useMemo(() => parseMoodTags(review.mood_tags), [review.mood_tags]);

  // MODULAR: valence per review is derived once and reused for both
  // the radar signal (via snap.ts canonical 2/5/8) and the Title Case
  // ScoreRow label. Single computation per card keeps the mood_tags
  // iteration out of both render sites.
  const valence = useMemo(() => deriveValence(moodTags), [moodTags]);

  // Hooks must run unconditionally: when no typewriter prop is passed
  // the hook is disabled (no timer) and the plain notes render.
  const tw = useTypewriter(review.notes ?? "", {
    enabled: typewriter?.enabled ?? false,
    onDone: typewriter?.onDone,
  });
  const notesDisplay = typewriter ? tw.display : review.notes;
  const notesTyping = typewriter !== undefined && typewriter.enabled && !tw.done;

  const tagMarkup = moodTags
    .map((t: string) => `<span class="feed-tag">${escapeHtml(t)}</span>`)
    .join("");

  return (
    <div className="border border-[var(--color-hair-strong)] p-4">
      <div className="flex items-center gap-2 mb-3 border-b border-[var(--color-hair)] pb-2">
        <span className="text-lg">{meta.icon}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      {/* MODULAR: one-line rubric so the three agents render as distinct
          reviewers rather than the same model asked three times. */}
      <p className="mb-3 -mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        {meta.focus}
      </p>

      {/* MODULAR: the agent's sync-fit + its distinct expert headline metric.
          Persisted detail (agent_reviews.detail) may be absent on legacy
          rows, so this block is gated on its presence. */}
      {review.detail && (
        <div className="mb-3 -mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span
            className="font-mono text-xs font-semibold tabular-nums"
            style={{ color: meta.color }}
          >
            Fit {review.detail.fit_score}/10
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            {review.detail.metric_label} ·
            <span className="text-[var(--color-ink)]">{review.detail.metric}/10</span>
          </span>
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* TasteGraph mini */}
        <div className="shrink-0">
          <TasteGraphMini
            values={{
              solo: review.solo_intensity,
              vocal: review.vocal_quality,
              energy: energyToNumber(review.energy_vs_studio),
              tempo: tempoToNumber(review.tempo_feel),
              valence: valenceToNumber(valence ?? "neutral"),
            }}
            size={100}
          />
        </div>

        {/* Rubric — animated per-axis bars */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
          <AxisBar label="Solo" value={review.solo_intensity} color={meta.color} />
          <AxisBar label="Vocal" value={review.vocal_quality} color={meta.color} />
        </div>
      </div>

      {/* Categorical axes — full width so labels never collide */}
      <div className="grid grid-cols-3 gap-x-4 mt-3">
        <AxisTriad
          label="Energy"
          options={["Lower", "Same", "Higher"]}
          active={["lower", "same", "higher"].indexOf(review.energy_vs_studio)}
          color={meta.color}
        />
        <AxisTriad
          label="Tempo"
          options={["Drag", "Locked", "Rush"]}
          active={["dragging", "locked", "rushing"].indexOf(review.tempo_feel)}
          color={meta.color}
        />
        <AxisTriad
          label="Valence"
          options={["Dark", "Neutral", "Bright"]}
          active={["dark", "neutral", "bright"].indexOf(valence ?? "neutral")}
          color={meta.color}
        />
      </div>

      {/* Mood tags — sanitized via DOMPurify */}
      {moodTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(tagMarkup) }} />
      )}

      {/* Rationale — the agent's written reasoning, framed as first-class */}
      {review.notes && (
        <div className="mt-3 border-t border-[var(--color-hair)] pt-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">
            Rationale
          </div>
          <p className="font-serif text-sm text-[var(--color-ink-2)] leading-snug">
            {notesDisplay}
            {notesTyping && (
              <span aria-hidden="true" className="text-[var(--color-rust)] animate-pulse">
                ▌
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// Lightweight variant shown between agent_started and agent_verdict.
function AgentThinkingCard({ meta }: { meta: AgentMeta }) {
  return (
    <div className="border border-[var(--color-hair-strong)] p-4">
      <div className="flex items-center gap-2 mb-3 border-b border-[var(--color-hair)] pb-2">
        <span className="text-lg">{meta.icon}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <div className="flex items-center gap-2 py-2">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--color-rust)] animate-pulse" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          analyzing the track…
        </span>
      </div>
    </div>
  );
}

// Failed slot advances the reveal cursor on mount so later cards are
// never blocked waiting on a typewriter that will not run.
function StreamFailedCard({
  meta,
  onSettled,
}: {
  meta: AgentMeta;
  onSettled: () => void;
}) {
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);
  useEffect(() => {
    onSettledRef.current();
  }, []);
  return (
    <div className="border border-[var(--color-hair-strong)] p-4 opacity-70">
      <div className="flex items-center gap-2 mb-3 border-b border-[var(--color-hair)] pb-2">
        <span className="text-lg">{meta.icon}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <p className="font-serif italic text-sm text-[var(--color-ink-3)] py-1">
        Review failed — this agent could not file a verdict.
      </p>
    </div>
  );
}

// MODULAR: AxisBar animates width on mount so the rubric "fills in"
// as each card lands in the staged AnimatePresence reveal — judges
// see the agent's scores materialize rather than pop in fully formed.
function AxisBar({ label, value, color }: { label: string; value: number; color: string }) {
  const clamped = Math.max(0, Math.min(10, value));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{label}</span>
        <span className="font-mono text-xs font-medium text-[var(--color-ink)] tabular-nums">{clamped}/10</span>
      </div>
      <div className="h-[3px] bg-[var(--color-hair)] mt-0.5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clamped * 10}%` }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="h-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}

// Categorical 3-way axis (energy / tempo / valence). Active segment
// carries the agent color; a -1 active index (unknown value) renders
// all segments inactive rather than crashing.
function AxisTriad({
  label,
  options,
  active,
  color,
}: {
  label: string;
  options: [string, string, string];
  active: number;
  color: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{label}</div>
      <div className="flex gap-[3px] mt-1" role="img" aria-label={`${label}: ${options[active] ?? "unknown"}`}>
        {options.map((_, i) => (
          <span
            key={i}
            className="h-[3px] flex-1"
            style={{ background: i === active ? color : "var(--color-hair)" }}
          />
        ))}
      </div>
      <div className="font-mono text-[10px] text-[var(--color-ink-2)] mt-0.5 truncate">
        {options[active] ?? "—"}
      </div>
    </div>
  );
}

// ── Skeletons ───────────────────────────────────────────

function QueueSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="py-4 px-3 -mx-3 border-t border-[var(--color-hair)] last:border-b border-l-2 border-l-transparent"
        >
          <div className="skel h-[17px] w-full max-w-[200px] mb-2" />
          <div className="skel h-[12px] w-[160px]" />
        </li>
      ))}
    </ul>
  );
}

function ReviewCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-[var(--color-hair-strong)] p-4">
          <div className="flex items-center gap-2 mb-3 border-b border-[var(--color-hair)] pb-2">
            <div className="skel h-[18px] w-[18px] rounded-none" />
            <div className="skel h-[11px] w-[130px]" />
          </div>
          <div className="flex items-start gap-4">
            <svg width={100} height={100} viewBox="-10 -10 140 140" aria-hidden="true" className="skel shrink-0">
              <polygon points="60,5 110,60 60,115 10,60" opacity="0.08" />
            </svg>
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="skel h-[10px] w-[50px]" />
              <div className="skel h-[10px] w-[50px]" />
              <div className="skel h-[10px] w-[50px]" />
              <div className="skel h-[10px] w-[50px]" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <div className="skel h-[22px] w-[56px]" />
            <div className="skel h-[22px] w-[48px]" />
          </div>
          <div className="skel h-[14px] w-full max-w-[300px] mt-3" />
        </div>
      ))}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────

// MODULAR: lightweight relative-time formatter for the recent-verdicts
// strip. Three buckets — < 60 min ago ("Xm ago"), < 24 h ("Xh ago"),
// else absolute short date ("M/D"). Avoids pulling in a date library
// (date-fns / dayjs) for one consumer. Naive UTC handling is fine
// because published_at is server-stamped ISO and the diff is in ms.
function humanRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
