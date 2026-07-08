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
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { apiClient, type AgentReviewRecord, type FeedRow, type QueueSubmission } from "@/lib/api-client";
import { parseMoodTags } from "@/lib/format";
import { energyToNumber, tempoToNumber, valenceToNumber } from "@/lib/snap";
import { deriveValence } from "@/services/taste-graph";
import type { Valence } from "@/lib/types";
import { escapeHtml } from "@/lib/utils";
import DOMPurify from "dompurify";

// ── Agent identity kit ─────────────────────────────────

const AGENT_META: Record<string, { icon: string; label: string; color: string }> = {
  production: { icon: "🎛️", label: "Production Agent", color: "var(--color-rust)" },
  performance: { icon: "🎤", label: "Performance Agent", color: "var(--color-ink)" },
  market: { icon: "📊", label: "Market Agent", color: "var(--color-ink-2)" },
};

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

// MODULAR: per-rating valence display labels (Title Case to match
// ENERGY_LABELS / TEMPO_LABELS). deriveValence runs against each
// review's mood_tags rather than the union (the radar renders
// per-review, not per-submission), so each agent's verdict on the
// same submission can land in different buckets -- that's by
// design and reflects honest disagreement between agents.
const VALENCE_LABELS: Record<Valence, string> = {
  bright: "Bright",
  neutral: "Neutral",
  dark: "Dark",
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-[var(--color-ink)] pt-8">
      {/* Recent Verdicts strip — full-width above the queue/reviews grid */}
      <section className="md:col-span-2 mb-2" aria-live="polite">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-serif text-xl font-black">Recent Verdicts</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            Last 3 published · live
          </span>
        </div>
        {recentVerdicts.length === 0 ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-6 border-t border-b border-[var(--color-hair)] text-center">
            No published versions yet.
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] mt-2">
              The first agent-reviewed + auto-published loop will land here.
            </div>
          </p>
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
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Agent review pane */}
      <section>
        <h3 className="font-serif text-2xl font-black mb-4">Agent Reviews</h3>
        {!selectedId ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border-t border-b border-[var(--color-hair)]">
            Select a submission from the queue to inspect agent reviews.
          </p>
        ) : reviewsLoading ? (
          <ReviewCardSkeleton count={3} />
        ) : reviews.length === 0 ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border-t border-b border-[var(--color-hair)]">
            Agents have not reviewed this submission yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {reviews.map((r) => {
              const meta = AGENT_META[r.agent_name] ?? { icon: "🤖", label: r.agent_name, color: "var(--color-ink)" };
              return (
                <AgentReviewCard key={`${r.submission_id}-${r.agent_name}`} review={r} meta={meta} />
              );
            })}
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
}: {
  review: AgentReviewRecord;
  meta: { icon: string; label: string; color: string };
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

        {/* Scores */}
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4 gap-y-1">
          <ScoreRow label="Solo" value={`${review.solo_intensity}/10`} />
          <ScoreRow label="Vocal" value={`${review.vocal_quality}/10`} />
          <ScoreRow label="Energy" value={ENERGY_LABELS[review.energy_vs_studio] ?? review.energy_vs_studio} />
          <ScoreRow label="Tempo" value={TEMPO_LABELS[review.tempo_feel] ?? review.tempo_feel} />
          <ScoreRow label="Valence" value={valence ? VALENCE_LABELS[valence] : "Neutral"} />
        </div>
      </div>

      {/* Mood tags — sanitized via DOMPurify */}
      {moodTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(tagMarkup) }} />
      )}

      {/* Notes */}
      {review.notes && (
        <p className="font-serif text-sm text-[var(--color-ink-2)] mt-3 leading-snug border-t border-[var(--color-hair)] pt-3">
          {review.notes}
        </p>
      )}
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{label}</span>
      <span className="font-mono text-sm font-medium text-[var(--color-ink)] tabular-nums">{value}</span>
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
