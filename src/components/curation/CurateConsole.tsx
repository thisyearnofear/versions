"use client";

// MODULAR: Curator console — queue + rate scorecard. The two-pane
// layout (queue on the left, scorecard on the right) is preserved
// from the vanilla version. The interactive TasteGraph drives the
// 4 quantitative axes; mood tags + notes are free-text inputs.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { TasteGraph, type TasteValues } from "@/components/curation/TasteGraph";
import { useToast } from "@/components/ui/Toast";
import { ApiError, apiClient } from "@/lib/api-client";
import { ENERGY_VALUE_TO_LABEL, snapEnergy, snapTempo, TEMPO_VALUE_TO_LABEL } from "@/lib/snap";

interface QueueItem {
  id: string;
  title: string;
  artist_name: string;
  version_type: string;
  genre?: string | null;
  ratingCount?: number;
}

const INITIAL_VALUES: TasteValues = { solo: 5, vocal: 5, energy: 5, tempo: 5 };

export function CurateConsole() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { showToast } = useToast();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [values, setValues] = useState<TasteValues>(INITIAL_VALUES);
  const [moodTags, setMoodTags] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshQueue = useCallback(async () => {
    try {
      const rows = await apiClient.getQueue(50);
      setQueue(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast(`Queue load failed: ${(err as Error).message}`, "error");
    }
  }, [showToast]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  // MODULAR: SSE connection for real-time queue updates.
  // Connects to /api/events and listens for queue-update events.
  // When a submission is added, claimed, or rated, the queue refreshes
  // automatically. Reconnects after 3s on error.
  const refreshQueueRef = useRef(refreshQueue);
  refreshQueueRef.current = refreshQueue;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("connected", () => {
        // Connection established.
      });

      es.addEventListener("queue-update", () => {
        // A submission was added, claimed, or rated. Refresh the queue.
        refreshQueueRef.current();
      });

      es.addEventListener("error", () => {
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

  const select = useCallback((item: QueueItem) => {
    setSelected(item);
    setValues(INITIAL_VALUES);
    setMoodTags("");
    setNotes("");
  }, []);

  const resetRadar = useCallback(() => {
    setValues(INITIAL_VALUES);
    showToast("Radar reset.", "info", 1500);
  }, [showToast]);

  const releaseClaim = useCallback(async () => {
    if (!selected || !address) return;
    try {
      await apiClient.releaseClaim(selected.id, { curatorWallet: address });
      showToast("Claim released.", "info");
      setSelected(null);
      setValues(INITIAL_VALUES);
      await refreshQueue();
    } catch {
      /* best-effort */
    }
  }, [address, refreshQueue, selected, showToast]);

  const submitRating = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!selected || !address) return;
      setBusy(true);
      try {
        const mood = moodTags.split(",").map((s) => s.trim()).filter(Boolean);
        const rating = {
          solo_intensity: Math.round(values.solo),
          vocal_quality: Math.round(values.vocal),
          energy_vs_studio: snapEnergy(values.energy),
          tempo_feel: snapTempo(values.tempo),
          mood_tags: mood,
          notes: notes || null,
        };

        const claimSig = await signMessageAsync({ message: "VERSIONS_LEPTON_CLAIM" });
        const claim = await apiClient.claim(selected.id, { curatorWallet: address, signature: claimSig });
        if (!claim.ok && claim.error && !/active claim/i.test(claim.error)) {
          throw new Error(claim.error);
        }
        const rateSig = await signMessageAsync({ message: "VERSIONS_LEPTON_RATE" });
        const resp = await apiClient.rate(selected.id, {
          curatorWallet: address,
          signature: rateSig,
          rating,
        });
        if (resp.published && !resp.published.alreadyPublished) {
          showToast("Version published! Fee pool settled.", "success", 6000);
        } else {
          showToast(`Rating recorded (${resp.rating_count}/3 needed for publish).`, "info");
        }
        setSelected(null);
        setValues(INITIAL_VALUES);
        setMoodTags("");
        setNotes("");
        await refreshQueue();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Rate failed: ${msg}`, "error", 6000);
      } finally {
        setBusy(false);
      }
    },
    [address, moodTags, notes, refreshQueue, selected, showToast, signMessageAsync, values],
  );

  return (
    <div className="grid md:grid-cols-2 gap-8 border-t border-[var(--color-ink)] pt-8">
      {/* Queue */}
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
          {queue.length === 0 && (
            <li className="py-10 border-t border-b border-[var(--color-hair)] font-serif italic text-[var(--color-ink-3)] text-center">
              The queue is empty.
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] mt-3">
                Seed the catalog to see submissions here.
              </div>
            </li>
          )}
          {queue.map((sub) => {
            const isSelected = selected?.id === sub.id;
            return (
              <li
                key={sub.id}
                onClick={() => select(sub)}
                className={`py-4 px-3 -mx-3 cursor-pointer border-t border-[var(--color-hair)] last:border-b transition-colors ${
                  isSelected ? "border-l-2 border-l-[var(--color-rust)] bg-[var(--color-paper-2)]" : "border-l-2 border-l-transparent hover:bg-[var(--color-paper)]/40"
                }`}
              >
                <div className="font-serif text-[17px] font-medium">{sub.title}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                  {sub.artist_name} · {sub.version_type}
                  {sub.ratingCount !== undefined && ` · ${sub.ratingCount}/3 ratings`}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Scorecard */}
      <section>
        <h3 className="font-serif text-2xl font-black mb-4">Scorecard</h3>
        {!selected ? (
          <p className="font-serif italic text-[var(--color-ink-3)] py-10 text-center border-t border-b border-[var(--color-hair)]">
            Select a submission from the queue to begin.
          </p>
        ) : (
          <form onSubmit={submitRating} className="flex flex-col gap-6">
            <header className="border-b border-[var(--color-ink)] pb-4">
              <h4 className="font-serif text-2xl font-medium tracking-tight">{selected.title}</h4>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1">
                {selected.artist_name} · {selected.version_type}
                {selected.genre && ` · ${selected.genre}`}
              </div>
            </header>

            <div className="flex flex-col md:flex-row items-center gap-6 py-6 border-t border-b border-[var(--color-hair)]">
              <div className="w-full md:w-1/2">
                <TasteGraph values={values} onChange={setValues} size={300} />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] text-center mt-3">
                  Drag the four points to rate.
                </p>
              </div>
              <div className="w-full md:w-1/2 grid grid-cols-2 gap-3 border-l-0 md:border-l md:border-[var(--color-hair-strong)] md:pl-6">
                <ReadoutRow label="SOLO" value={Math.round(values.solo).toString()} suffix="/10" />
                <ReadoutRow label="VOCAL" value={Math.round(values.vocal).toString()} suffix="/10" />
                <ReadoutRow label="ENERGY" value={ENERGY_VALUE_TO_LABEL[snapEnergy(values.energy)]} />
                <ReadoutRow label="TEMPO" value={TEMPO_VALUE_TO_LABEL[snapTempo(values.tempo)]} />
              </div>
            </div>

            <button
              type="button"
              onClick={resetRadar}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] hover:text-[var(--color-rust)] self-start"
            >
              Reset radar to 5/5/5/5
            </button>

            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
                Mood tags (comma-separated)
              </span>
              <input
                value={moodTags}
                onChange={(e) => setMoodTags(e.target.value)}
                placeholder="Bluesy, Raw, Euphoric"
                className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
                Notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg resize-none"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void releaseClaim()}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] hover:text-[var(--color-rust)]"
              >
                Release claim
              </button>
              <button
                type="submit"
                disabled={busy || !isConnected}
                className="ml-auto bg-[var(--color-rust)] text-[var(--color-paper)] border border-[var(--color-rust)] font-mono text-[11px] uppercase tracking-[0.22em] px-8 py-4 hover:bg-[var(--color-rust-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Submitting…" : "Submit rating"}
              </button>
            </div>
            {!isConnected && (
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                Connect your wallet to claim + sign the rating.
              </p>
            )}
            {loading && (
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                Loading…
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}

function ReadoutRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-hair)] pb-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">{label}</span>
      <span className="font-mono text-base font-medium text-[var(--color-ink)] tabular-nums">
        {value}
        {suffix && <span className="text-[var(--color-ink-3)] ml-1">{suffix}</span>}
      </span>
    </div>
  );
}
