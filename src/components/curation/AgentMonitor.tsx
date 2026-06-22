"use client";

// MODULAR: Agent monitor dashboard. Replaces the human-curation
// CurateConsole. Shows the submission queue with live agent review
// summaries — no wallet connection, no claim/rate flow. The AI
// agents (Production, Performance, Market) handle everything
// autonomously; this is a read-only window into their activity.
// SSE keeps the queue fresh in real time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { apiClient, type AgentReviewRecord, type QueueSubmission } from "@/lib/api-client";
import { energyToNumber, tempoToNumber } from "@/lib/snap";
import { escapeHtml } from "@/lib/utils";

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

// ── Component ───────────────────────────────────────────

export function AgentMonitor() {
  const [queue, setQueue] = useState<QueueSubmission[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<AgentReviewRecord[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

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

  // Initial load
  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  // SSE — keep queue live
  const refreshQueueRef = useRef(refreshQueue);
  refreshQueueRef.current = refreshQueue;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");
      es.addEventListener("queue-update", () => {
        refreshQueueRef.current();
      });
      es.addEventListener("error", () => {
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
    <div className="grid md:grid-cols-2 gap-8 border-t border-[var(--color-ink)] pt-8">
      {/* Queue pane */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-serif text-2xl font-black">Queue</h3>
          <button
            type="button"
            onClick={() => void refreshQueue()}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]"
          >
            Refresh
          </button>
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
  const moodTags = useMemo(() => {
    try {
      return Array.isArray(review.mood_tags) ? review.mood_tags : [];
    } catch {
      return [];
    }
  }, [review.mood_tags]);

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
        </div>
      </div>

      {/* Mood tags */}
      {moodTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3" dangerouslySetInnerHTML={{ __html: tagMarkup }} />
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
