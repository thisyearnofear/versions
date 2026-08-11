"use client";

// MODULAR: Audio player with custom on-brand controls. Replaces the
// browser's default <audio controls> with a play button + animated
// wave indicator + meta block. The component is fully controlled
// via props so it can be embedded in feed rows, scorecards, or
// playlist cards.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { fmtTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPlayingTrackKey, setPlayingTrackKey } from "@/lib/player-bridge";

export interface AudioPlayerProps {
  src: string;
  title: string;
  by?: string;
  /** MODULAR: identity key published to the playing-track bridge so
   *  other surfaces (vinyl covers, radars) can react to what's on. */
  trackKey?: string;
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
  trackKey,
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
  const reduce = useReducedMotion();

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      // MODULAR: unmounting a playing player must clear the bridge so
      // no orphaned key keeps a cover spinning — but only if THIS
      // player still owns it (a newer track may have taken over).
      if (trackKey && getPlayingTrackKey() === trackKey) setPlayingTrackKey(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* MODULAR: Analog Wave reveal -- two framer-motion layers per bar.
          Outer motion.div owns the one-shot wake-up: opacity 0 -> 1 and
          uniform scale 0.6 -> 1 over 0.32s with a 5-phase stagger cap
          ((i % 5) * 0.08s) so the entry reads as a 5-band EQ waking up
          rather than 24 separate pops. The outer fades back to its
          initial state on pause (no repeat, smooth in/out).
          Inner motion.div owns the perpetual pulse: scaleY keyframes
          that begin AND end at scaleY 1, so the loop boundary is
          invisible -- no flicker. The {playing && ...} gate unmounts
          the inner div on pause so the pulse restarts cleanly on each
          play and reduced-motion users get a stable bar via the global
          MotionConfig (transition durations 0) + globals.css media
          query (animation-duration 0.01ms).
          transformOrigin "50% 100%" is set on BOTH layers so the
          uniform outer scale grows the bar upward from the baseline,
          and the inner scaleY pulse also pivots on the baseline. */}
      <div className="flex items-center gap-[2px] flex-1 h-6">
        {barHeights.map((h, i) => (
          <motion.div
            // MODULAR: remount on play/pause toggle so the per-state
            // `initial` below runs every transition. Initial == animate
            // when paused -> no tween, bars just sit at full size.
            // Initial = { 0, 0.6 } when playing -> one-shot wake-up
            // reveal runs once + then stops at full size.
            key={playing ? `p-${i}` : `s-${i}`}
            className="flex-1"
            style={{ height: `${h}%`, transformOrigin: "50% 100%" }}
            initial={
              !!reduce || !playing
                ? { opacity: 1, scale: 1 }
                : { opacity: 0, scale: 0.6 }
            }
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.32,
              delay: playing ? (i % 5) * 0.08 : 0,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {playing && (
              <motion.div
                className="w-full h-full bg-[var(--color-hair-strong)]"
                style={{ transformOrigin: "50% 100%" }}
                animate={{
                  scaleY: [1, 0.55, 1, 0.85, 1, 0.95, 1],
                }}
                transition={{
                  duration: 2.4,
                  delay: (i % 5) * 0.08,
                  ease: "easeInOut",
                  repeat: Infinity,
                  repeatType: "loop",
                  times: [0, 0.2, 0.35, 0.5, 0.65, 0.85, 1],
                }}
              />
            )}
          </motion.div>
        ))}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] tabular-nums w-24 text-right flex-shrink-0 hidden sm:block">
        {duration > 0 ? `${fmtTimecode(currentTime)} / ${fmtTimecode(duration)}` : "Ready to play"}
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          if (trackKey) setPlayingTrackKey(trackKey);
          onPlay?.();
        }}
        onPause={() => {
          setPlaying(false);
          // MODULAR: only clear the bridge if THIS player owns it (a
          // newer track may have taken over in a multi-player list).
          if (trackKey && getPlayingTrackKey() === trackKey) setPlayingTrackKey(null);
          onPause?.();
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
          if (trackKey && getPlayingTrackKey() === trackKey) setPlayingTrackKey(null);
          onEnded?.();
        }}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
      />
      {/* progress hint — only once metadata is loaded (avoids the "0:00 / 0:00 progress: 0%" no-op leak) */}
      {duration > 0 && (
        <div className="sr-only" aria-hidden="true">
          progress: {(progress * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}
