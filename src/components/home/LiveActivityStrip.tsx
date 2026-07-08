"use client";

// MODULAR: Live activity strip for the home page. Shows two compact
// columns — the submission queue (awaiting curation) and recently
// published versions — so a first-time visitor immediately sees
// that the platform is alive. Falls back gracefully to a "quiet"
// state with zero activity messaging.
//
// No wallet connection required. Polls once on mount; the SSE
// connection in AgentMonitor / FeedView handles live updates on
// those pages. The home page just needs a snapshot, not a stream.

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type QueueSubmission, type FeedRow } from "@/lib/api-client";

interface ActivityState {
  queue: QueueSubmission[];
  published: FeedRow[];
  loading: boolean;
  error: boolean;
}

export function LiveActivityStrip() {
  const [state, setState] = useState<ActivityState>({
    queue: [],
    published: [],
    loading: true,
    error: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // MODULAR: allSettled so a queue failure doesn't nuke the
      // published column (and vice versa). Each result is mapped
      // independently.
      const [queueResult, feedResult] = await Promise.allSettled([
        apiClient.getQueue(4),
        apiClient.getFeed({ limit: 4 }),
      ]);
      if (cancelled) return;
      const queue =
        queueResult.status === "fulfilled" && Array.isArray(queueResult.value)
          ? queueResult.value
          : [];
      const published =
        feedResult.status === "fulfilled" ? feedResult.value?.rows ?? [] : [];
      const bothFailed = queueResult.status === "rejected" && feedResult.status === "rejected";
      setState({
        queue,
        published,
        loading: false,
        error: bothFailed,
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="border-t border-[var(--color-hair-strong)]">
        <div className="px-6 md:px-12 py-8 grid md:grid-cols-2 gap-8">
          <ActivityColumnSkeleton />
          <ActivityColumnSkeleton />
        </div>
      </div>
    );
  }

  if (state.error && state.queue.length === 0 && state.published.length === 0) {
    return null; // No data and fetch failed — don't show an empty box.
  }

  const totalActive = state.queue.length + state.published.length;
  if (totalActive === 0) {
    return (
      <div className="border-t border-[var(--color-hair-strong)]">
        <div className="px-6 md:px-12 py-10 text-center">
          <p className="font-serif italic text-[var(--color-ink-3)]">
            The catalog is being seeded. Be the first to submit.
          </p>
          <Link
            href="/submit"
            className="inline-flex items-center gap-2 mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-rust)] hover:text-[var(--color-ink)] transition-colors"
          >
            Submit a version <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-hair-strong)]">
      <div className="px-6 md:px-12 py-8">
        <div className="flex items-center gap-3 mb-6">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-rust)] opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--color-rust)]" />
          </span>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-2)]">
            Live now
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {/* Queue — awaiting curation */}
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-4">
              In the curation queue
            </h3>
            {state.queue.length > 0 ? (
              <ul className="flex flex-col">
                {state.queue.map((sub) => (
                  <li
                    key={sub.id}
                    className="border-t border-[var(--color-hair)] last:border-b py-3"
                  >
                    <Link
                      href="/agents"
                      className="block group"
                    >
                      <div className="font-serif text-base font-medium group-hover:text-[var(--color-rust)] transition-colors">
                        {sub.title}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-0.5">
                        {sub.artist_name} · {sub.version_type}
                        {sub.ratingCount !== undefined && (
                          <span className="ml-2 text-[var(--color-rust)]">
                            {sub.ratingCount}/3 rated
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-serif italic text-[var(--color-ink-3)] text-sm py-3 border-t border-[var(--color-hair)] border-b">
                Queue is clear — every submission has been reviewed.
              </p>
            )}
          </div>

          {/* Recently published */}
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-4">
              Recently published
            </h3>
            {state.published.length > 0 ? (
              <ul className="flex flex-col">
                {state.published.map((v) => (
                  <li
                    key={v.submission_id}
                    className="border-t border-[var(--color-hair)] last:border-b py-3"
                  >
                    <Link
                      href="/feed"
                      className="block group"
                    >
                      <div className="font-serif text-base font-medium group-hover:text-[var(--color-rust)] transition-colors">
                        {v.title}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-0.5">
                        {v.artist_name} · {v.version_type} · {v.rating_count} ratings
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-serif italic text-[var(--color-ink-3)] text-sm py-3 border-t border-[var(--color-hair)] border-b">
                No published versions yet — submit to seed the catalog.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityColumnSkeleton() {
  return (
    <div>
      <div className="skel h-[10px] w-[120px] mb-4" />
      <ul className="flex flex-col">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="border-t border-[var(--color-hair)] last:border-b py-3">
            <div className="skel h-[16px] w-full max-w-[200px] mb-2" />
            <div className="skel h-[10px] w-[140px]" />
          </li>
        ))}
      </ul>
    </div>
  );
}
