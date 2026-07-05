"use client";

// MODULAR: Audio player with custom on-brand controls. Replaces the
// browser's default <audio controls> with a play button + animated
// wave indicator + meta block. The component is fully controlled
// via props so it can be embedded in feed rows, scorecards, or
// playlist cards.

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface AudioPlayerProps {
  src: string;
  title: string;
  by?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  bars?: number;
  className?: string;
}

// Deterministic bar heights so the wave is stable between plays.
function makeBars(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 30 + ((i * 7) % 17) + ((i * i) % 23));
}

export function AudioPlayer({
  src,
  title,
  by,
  onPlay,
  onPause,
  onEnded,
  bars = 24,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [barHeights] = useState<number[]>(() => makeBars(bars));

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setCurrentTime(audio.currentTime);
    setProgress(audio.currentTime / audio.duration);
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (audio?.duration) setDuration(audio.duration);
  }, []);

  return (
    <div className={cn("flex items-center gap-3 md:gap-4 py-2", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`Play ${title}`}
        className="grid place-items-center w-9 h-9 rounded-full bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-[transform,colors] duration-150 ease-out active:scale-[0.97] font-mono text-sm flex-shrink-0"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="font-serif text-base font-medium truncate">{title}</div>
        {by && (
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-2)] truncate">
            {by}
          </div>
        )}
      </div>
      <div className={cn("flex items-center gap-[2px] flex-1 h-6", playing && "playing")}>
        {barHeights.map((h, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 bg-[var(--color-hair-strong)] transition-transform",
              playing && "animate-wave",
            )}
            style={{
              height: `${h}%`,
              animationDelay: playing ? `${(i % 5) * 0.15}s` : undefined,
            }}
          />
        ))}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] tabular-nums w-20 text-right flex-shrink-0 hidden sm:block">
        {fmtTimecode(currentTime)} / {fmtTimecode(duration)}
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          onPlay?.();
        }}
        onPause={() => {
          setPlaying(false);
          onPause?.();
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
          onEnded?.();
        }}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
      />
      <style jsx>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        .playing :global(.animate-wave) {
          animation: wave 1.2s ease-in-out infinite;
        }
      `}</style>
      {/* progress hint as a subtle bar (kept off the row layout, sits below on hover) */}
      <div className="sr-only" aria-hidden="true">
        progress: {(progress * 100).toFixed(0)}%
      </div>
    </div>
  );
}
