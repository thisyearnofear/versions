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
import { energyToNumber, tempoToNumber } from "@/lib/snap";
import { escapeHtml } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Filters {
  mood: string;
  energy: string;
  tempo: string;
  minSolo: string;
}

const EMPTY_FILTERS: Filters = { mood: "", energy: "", tempo: "", minSolo: "" };

interface FeaturedQuote {
  id: string;
  text: string;
  by: string;
  role: string;
}

const FALLBACK_QUOTE: FeaturedQuote = {
  id: "fallback",
  text: "We're not in the singles business; we're in the take business.",
  by: "house rule",
  role: "taste maker",
};

export function FeedView({ initialRows = [] }: { initialRows?: FeedRow[] }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<FeedRow[]>(initialRows);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<FeaturedQuote>(FALLBACK_QUOTE);

  // MODULAR: SSE connection for real-time feed updates.
  // Uses refs so the EventSource persists across filter changes
  // without reconnecting. feed-update events re-fetch the feed
  // with whatever the current filters are.
  const fetchRowsRef = useRef(fetchRows);
  fetchRowsRef.current = fetchRows;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("connected", () => {
        // Connection established. No action needed — the stream is live.
      });

      es.addEventListener("feed-update", () => {
        // A new version was published. Re-fetch with current filters.
        fetchRowsRef.current(filtersRef.current);
      });

      es.addEventListener("error", () => {
        // Connection lost. Attempt to reconnect after 3s.
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

  // Featured quotes (loaded once; fallback if fetch fails).
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

  const fetchRows = useCallback(
    async (f: Filters) => {
      setLoading(true);
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
        showToast(`Feed load failed: ${(err as Error).message}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    // Skip the initial fetch — initialRows already populated state.
    if (initialRows.length === 0) {
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

  return (
    <>
      <form onSubmit={onFilterSubmit} className="grid md:grid-cols-5 gap-4 mb-12 max-w-4xl border-t border-[var(--color-ink)] border-b py-6">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
            Mood
          </span>
          <input
            name="mood"
            placeholder="Bluesy"
            defaultValue={filters.mood}
            className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-2 font-serif"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
            Energy
          </span>
          <select
            name="energy"
            defaultValue={filters.energy}
            className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-2 font-serif"
          >
            <option value="">Any</option>
            <option value="lower">Lower</option>
            <option value="same">Same</option>
            <option value="higher">Higher</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
            Tempo
          </span>
          <select
            name="tempo"
            defaultValue={filters.tempo}
            className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-2 font-serif"
          >
            <option value="">Any</option>
            <option value="dragging">Dragging</option>
            <option value="locked">Locked</option>
            <option value="rushing">Rushing</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
            Min solo
          </span>
          <input
            type="number"
            name="minSolo"
            min={1}
            max={10}
            defaultValue={filters.minSolo}
            className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-2 font-serif"
          />
        </label>
        <button
          type="submit"
          className="self-end bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors"
        >
          {loading ? "Loading…" : "Filter"}
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="border-t border-b border-[var(--color-hair)] py-10 font-serif text-[var(--color-ink-2)]">
          <strong className="block text-[var(--color-ink)] font-medium mb-1">
            The feed is empty.
          </strong>
          Once 3 AI agent curators review a submission it lands here.
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] mt-3 text-[var(--color-ink-3)]">
            Seed the catalog to see published versions.
          </div>
          <blockquote className="mt-8 pt-6 border-t border-[var(--color-hair-strong)] max-w-[60ch]">
            <p className="font-serif italic text-[22px] leading-[1.45] text-[var(--color-ink)] mb-3">
              {quote.text}
            </p>
            <footer className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
              — <cite className="not-italic text-[var(--color-ink)] font-medium">{quote.by}</cite>
              <span className="ml-2 text-[var(--color-ink-2)]">{quote.role}</span>
            </footer>
          </blockquote>
        </div>
      ) : (
        <ul className="flex flex-col">
          {rows.map((v) => (
            <FeedRowItem key={v.submission_id} row={v} />
          ))}
        </ul>
      )}
    </>
  );
}

function FeedRowItem({ row }: { row: FeedRow }) {
  const tags = useMemo(() => {
    try {
      return JSON.parse(row.aggregated_mood_tags || "[]") as string[];
    } catch {
      return [];
    }
  }, [row.aggregated_mood_tags]);

  const edition = (row.submission_id || "").replace(/-/g, "").slice(0, 4).toUpperCase();
  const pressed = (row.published_at || "").slice(0, 10);
  const audioUrl = `/api/v1/uploads/${row.audio_path?.split("/").pop() ?? ""}`;
  const cover = row.cover_svg;
  const tagMarkup = tags
    .map((t) => `<span class="feed-tag">${escapeHtml(t)}</span>`)
    .join("");

  return (
    <li className="grid md:grid-cols-[1fr_auto] gap-6 md:gap-8 py-8 border-t border-[var(--color-hair)] last:border-b">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mb-2 pb-2 border-b border-[var(--color-hair)]">
          Edition No <span className="text-[var(--color-ink)] font-medium">{edition}</span> · Pressed{" "}
          <span className="text-[var(--color-ink)] font-medium">{pressed}</span>
        </div>
        <h4 className="font-serif text-[28px] md:text-[32px] font-normal tracking-tight mb-2 leading-[1.1]">
          {row.title}
        </h4>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
          {row.artist_name} · {row.version_type}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
          solo {(row.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
          {(row.avg_vocal_quality ?? 0).toFixed(1)} · {row.energy_consensus ?? "-"} ·{" "}
          {row.tempo_consensus ?? "-"} · {row.rating_count} ratings{" "}
          <span className="text-[var(--color-rust)]">· AI agents</span>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3" dangerouslySetInnerHTML={{ __html: tagMarkup }} />
        )}
        {cover && (
          <div
            className="w-20 h-20 mt-4 border border-[var(--color-hair)]"
            dangerouslySetInnerHTML={{ __html: cover }}
          />
        )}
        <div className="mt-4">
          <AudioPlayer src={audioUrl} title={row.title} by={row.artist_name} />
        </div>
      </div>
      <div className="flex items-start justify-center md:justify-end">
        <TasteGraphMini
          values={{
            solo: row.avg_solo_intensity ?? 0,
            vocal: row.avg_vocal_quality ?? 0,
            energy: energyToNumber(row.energy_consensus ?? "same"),
            tempo: tempoToNumber(row.tempo_consensus ?? "locked"),
          }}
        />
      </div>
    </li>
  );
}
