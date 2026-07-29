"use client";

// MODULAR: Feed view — list of published versions with the editorial
// "Edition No / Pressed" treatment, taste-graph mini, mood tags, and
// the custom AudioPlayer. Filters (mood / energy / tempo / min solo)
// hit the API with URL params and re-render the list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { TasteGraphMini } from "@/components/curation/TasteGraph";
import { useToast } from "@/components/ui/Toast";
import { apiClient, type FeedRow } from "@/lib/api-client";
import { parseMoodTags } from "@/lib/format";
import { energyToNumber, tempoToNumber, valenceToNumber } from "@/lib/snap";
import { deriveValence } from "@/services/taste-graph";
import { escapeHtml } from "@/lib/utils";
import { track } from "@/lib/analytics";
import DOMPurify from "dompurify";
import { AnimatePresence, motion } from "framer-motion";

// Sanitize SVG/HTML with DOMPurify — allow only safe SVG tags and attributes.
function sanitize(unsafe: string): string {
  return DOMPurify.sanitize(unsafe, {
    ALLOWED_TAGS: ["svg", "path", "circle", "polygon", "rect", "line", "text", "g", "defs", "linearGradient", "stop", "span"],
    ALLOWED_ATTR: ["d", "viewBox", "width", "height", "fill", "stroke", "strokeWidth", "stroke-width", "strokeLinejoin", "stroke-linejoin", "cx", "cy", "r", "x", "y", "points", "textAnchor", "dominantBaseline", "fontFamily", "fontSize", "letterSpacing", "class", "data-tg-polygon", "data-tg-axis", "aria-hidden", "xmlns", "role"],
  });
}

interface Filters {
  mood: string;
  energy: string;
  tempo: string;
  minSolo: string;
}

const EMPTY_FILTERS: Filters = { mood: "", energy: "", tempo: "", minSolo: "" };

export function FeedView({ initialRows = [] }: { initialRows?: FeedRow[] }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<FeedRow[]>(initialRows);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [sseConnected, setSseConnected] = useState(true);

  const fetchRows = useCallback(
    async (f: Filters) => {
      setLoading(true);
      setFeedError(false);
      try {
        const resp = await apiClient.getFeed({
          mood: f.mood || undefined,
          energy: f.energy || undefined,
          tempo: f.tempo || undefined,
          minSolo: f.minSolo || undefined,
          limit: 50,
        });
        setRows(resp.rows || []);
      } catch (err) {
        setFeedError(true);
        track("feed_load_failed", { error: (err as Error).message.slice(0, 120) });
        showToast(`Feed load failed: ${(err as Error).message}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  // MODULAR: SSE connection for real-time feed updates.
  // Uses refs so the EventSource persists across filter changes
  // without reconnecting. feed-update events re-fetch the feed
  // with whatever the current filters are.
  const fetchRowsRef = useRef(fetchRows);
  const filtersRef = useRef(filters);
  useEffect(() => {
    fetchRowsRef.current = fetchRows;
    filtersRef.current = filters;
  }, [fetchRows, filters]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("connected", () => {
        // Connection established.
        setSseConnected(true);
      });

      es.addEventListener("feed-update", () => {
        // A new version was published. Re-fetch with current filters.
        fetchRowsRef.current(filtersRef.current);
      });

      es.addEventListener("error", () => {
        // MODULAR: was silently reconnecting with no user feedback.
        // Now surfaces a stale indicator so the user knows the feed
        // may be out of date, and tracks the reconnect so we can
        // measure connection reliability.
        setSseConnected(false);
        track("sse_reconnect", { target: "feed" });
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
    // Skip the initial fetch — initialRows already populated state.
    if (initialRows.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchRows(EMPTY_FILTERS);
    }
  }, [fetchRows, initialRows.length]);

  const onFilterSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const next: Filters = {
        mood: (fd.get("mood") as string) || "",
        energy: (fd.get("energy") as string) || "",
        tempo: (fd.get("tempo") as string) || "",
        minSolo: (fd.get("minSolo") as string) || "",
      };
      setFilters(next);
      void fetchRows(next);
    },
    [fetchRows],
  );

  const [showFilters, setShowFilters] = useState(false);

  return (
    <>
      {/* Compact filter toggle */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
        >
          {showFilters ? "▾ Filters" : "▸ Filters"}
        </button>
        {!sseConnected && rows.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-ink-3)] mr-1.5" />
            Reconnecting…
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.form
            onSubmit={onFilterSubmit}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6 border-t border-b border-[var(--color-hair)] py-4">
              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] block mb-1">
                  Mood
                </span>
                <input
                  name="mood"
                  placeholder="Bluesy"
                  defaultValue={filters.mood}
                  className="w-full bg-transparent border-b border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-1 font-serif text-sm"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] block mb-1">
                  Energy
                </span>
                <select
                  name="energy"
                  defaultValue={filters.energy}
                  className="w-full bg-transparent border-b border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-1 font-serif text-sm"
                >
                  <option value="">Any</option>
                  <option value="lower">Lower</option>
                  <option value="same">Same</option>
                  <option value="higher">Higher</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] block mb-1">
                  Tempo
                </span>
                <select
                  name="tempo"
                  defaultValue={filters.tempo}
                  className="w-full bg-transparent border-b border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-1 font-serif text-sm"
                >
                  <option value="">Any</option>
                  <option value="dragging">Dragging</option>
                  <option value="locked">Locked</option>
                  <option value="rushing">Rushing</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] block mb-1">
                  Min solo
                </span>
                <input
                  type="number"
                  name="minSolo"
                  min={1}
                  max={10}
                  defaultValue={filters.minSolo}
                  className="w-full bg-transparent border-b border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-1 font-serif text-sm"
                />
              </label>
              <button
                type="submit"
                className="self-end bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.14em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors"
              >
                {loading ? "…" : "Filter"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Error retry */}
      {feedError && !loading && (
        <div className="flex items-center gap-3 mb-4 border-t border-b border-[var(--color-rust)] py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-rust)]">
            Feed couldn&rsquo;t load.
          </span>
          <button
            type="button"
            onClick={() => void fetchRows(filters)}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink)] hover:text-[var(--color-rust)] transition-colors"
          >
            <span aria-hidden="true">↻ </span>Retry
          </button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <FeedSkeleton count={5} />
      ) : rows.length === 0 ? (
        <div className="border-t border-b border-[var(--color-hair)] py-12 text-center">
          <p className="font-serif italic text-[var(--color-ink-3)]">
            The feed is empty. Submit a track to seed the catalog.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {rows.map((v, i) => (
            <FeedRowItem key={v.submission_id} row={v} animationDelay={Math.min(i * 0.08, 0.6)} />
          ))}
        </ul>
      )}
    </>
  );
}

// ── Skeleton ────────────────────────────────────────────

function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 py-4 border-t border-[var(--color-hair)] last:border-b"
        >
          <div className="skel w-12 h-12 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skel h-[18px] w-full max-w-[240px]" />
            <div className="skel h-[10px] w-[140px]" />
          </div>
          <div className="skel h-[14px] w-[30px] shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function FeedRowItem({ row, animationDelay = 0 }: { row: FeedRow; animationDelay?: number }) {
  const [expanded, setExpanded] = useState(false);
  const tags = useMemo(() => parseMoodTags(row.aggregated_mood_tags), [row.aggregated_mood_tags]);
  const valence = useMemo(() => deriveValence(tags), [tags]);

  const audioUrl = `/api/v1/uploads/${row.audio_path?.split("/").pop() ?? ""}`;
  const cover = row.cover_svg;
  const tagMarkup = tags
    .map((t) => `<span class="feed-tag">${escapeHtml(t)}</span>`)
    .join("");
  const score = ((row.avg_solo_intensity ?? 0) + (row.avg_vocal_quality ?? 0)) / 2;

  return (
    <motion.li
      initial={{ opacity: 0, rotateZ: -2, y: 10 }}
      whileInView={{ opacity: 1, rotateZ: 0, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1], delay: animationDelay }}
      className="border-t border-[var(--color-hair)] last:border-b"
    >
      {/* Compact collapsed row — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-4 py-4 text-left group"
        aria-expanded={expanded}
      >
        {/* Vinyl-style circular cover */}
        <div
          className="shrink-0 w-12 h-12 rounded-full overflow-hidden border-2 border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] grid place-items-center transition-transform group-hover:rotate-90 duration-500"
        >
          {cover ? (
            <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: sanitize(cover) }} />
          ) : (
            <span className="font-serif text-lg font-black text-[var(--color-rust)]">
              {row.title.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        {/* Title + artist */}
        <div className="min-w-0 flex-1">
          <div className="font-serif text-lg font-medium truncate">{row.title}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] truncate">
            {row.artist_name} · {row.version_type}
          </div>
        </div>
        {/* Score chip */}
        <div className="shrink-0 flex items-center gap-3">
          {score > 0 && (
            <span className="font-mono text-sm font-medium tabular-nums text-[var(--color-ink-2)]">
              {score.toFixed(1)}
            </span>
          )}
          {tags.length > 0 && (
            <span className="hidden sm:inline font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              {tags.slice(0, 2).join(" · ")}
            </span>
          )}
          <span
            className="font-mono text-[10px] text-[var(--color-ink-3)] transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▾
          </span>
        </div>
      </button>

      {/* Expanded detail — progressive disclosure */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 pb-6">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mb-3">
                  solo {(row.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
                  {(row.avg_vocal_quality ?? 0).toFixed(1)} · {row.energy_consensus ?? "-"} ·{" "}
                  {row.tempo_consensus ?? "-"} · {valence ?? "-"} · {row.rating_count} ratings{" "}
                  <span className="text-[var(--color-rust)]">· AI agents</span>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4" dangerouslySetInnerHTML={{ __html: tagMarkup }} />
                )}
                <AudioPlayer src={audioUrl} title={row.title} by={row.artist_name} />
              </div>
              <div className="flex items-start justify-center md:justify-end">
                <TasteGraphMini
                  values={{
                    solo: row.avg_solo_intensity ?? 0,
                    vocal: row.avg_vocal_quality ?? 0,
                    energy: energyToNumber(row.energy_consensus ?? "same"),
                    tempo: tempoToNumber(row.tempo_consensus ?? "locked"),
                    valence: valenceToNumber(valence ?? "neutral"),
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
