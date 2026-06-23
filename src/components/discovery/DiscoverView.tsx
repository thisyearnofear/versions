"use client";

// MODULAR: Discover view — A&R agent playlists + per-play economy.
// Playlists are loaded from the API; each card lists tracks with a
// per-play payout indicator. Clicking the play button hits the
// /api/v1/ar/play endpoint to settle the $0.0005 USDC payment.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { useToast } from "@/components/ui/Toast";
import { apiClient, type Playlist } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
      showToast(`Playlists load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
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

      {loading && playlists.length === 0 ? (
        <DiscoverSkeleton count={2} />
      ) : playlists.length === 0 ? (
        <div className="border-t border-b border-[var(--color-hair)] py-10 font-serif text-[var(--color-ink-2)] text-center">
          <strong className="block text-[var(--color-ink)] font-medium mb-1">
            No playlists yet.
          </strong>
          Click &quot;Generate playlists&quot; to let the A&amp;R agent curate from the published catalog.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {playlists.map((pl) => (
            <PlaylistCard key={pl.id} playlist={pl} listenerWallet={address} isConnected={isConnected} />
          ))}
        </div>
      )}
    </>
  );
}

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

  const onPlay = useCallback(
    async (versionId: string) => {
      setPayingId(versionId);
      try {
        const wallet = listenerWallet ?? `anonymous_listener_${Date.now()}`;
        await apiClient.play({ playlistId: playlist.id, versionId, listenerWallet: wallet });
        showToast("Play settled — $0.0005 paid to artist on Arc", "success", 4000);
      } catch (err) {
        showToast(`Play failed: ${(err as Error).message}`, "error");
      } finally {
        setTimeout(() => setPayingId(null), 1500);
      }
    },
    [listenerWallet, playlist.id, showToast],
  );

  return (
    <article className="border-t border-[var(--color-ink)] pt-6">
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
      <ul className="border-t border-[var(--color-hair)]">
        {(playlist.tracks ?? []).map((t) => {
          const audioUrl = `/api/v1/uploads/${t.audio_path?.split("/").pop() ?? ""}`;
          return (
            <li
              key={t.submission_id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-[var(--color-hair)]"
            >
              <div className="flex-1 min-w-0">
                <AudioPlayer src={audioUrl} title={t.title} by={t.artist_name} />
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] mt-1 ml-12">
                  {t.version_type} · solo {(t.avg_solo_intensity ?? 0).toFixed(1)} · vocal{" "}
                  {(t.avg_vocal_quality ?? 0).toFixed(1)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onPlay(t.submission_id)}
                disabled={payingId === t.submission_id}
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.1em] border px-2.5 py-1.5 transition-colors",
                  payingId === t.submission_id
                    ? "border-[var(--color-hair-strong)] text-[var(--color-ink-3)] cursor-wait"
                    : "border-[var(--color-rust)] text-[var(--color-rust)] hover:bg-[var(--color-rust)] hover:text-[var(--color-paper)]",
                )}
                title={isConnected ? "Pay $0.0005 USDC to the artist on Arc" : "Connect a wallet to be the listener of record"}
              >
                {payingId === t.submission_id ? "Settling…" : "$0.0005 → artist"}
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ── Skeleton ────────────────────────────────────────────

function DiscoverSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-8">
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="border-t border-[var(--color-ink)] pt-6">
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
