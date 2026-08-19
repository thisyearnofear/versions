"use client";

// MODULAR: FamilyCompare — A/B audition for a version family. Two takes
// (the family's best match and one sibling) share ONE transport: play/
// pause, a single position bar, and an A/B switch that preserves the
// playback position. This is the supervisor's actual decision moment —
// "same song, two artist-approved takes, which one under the picture?" —
// rendered as one compact control instead of two separate players.
//
// Deterministic and self-contained: two <audio> elements, no external
// state. Unmounting pauses both.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtTimecode } from "@/lib/format";

export interface CompareTake {
  submissionId: string;
  title: string;
  artistName: string;
  audioSrc: string;
  fitScore: number;
}

export function FamilyCompare({ a, b }: { a: CompareTake; b: CompareTake }) {
  const audioA = useRef<HTMLAudioElement | null>(null);
  const audioB = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<"A" | "B">("A");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const activeRef = active === "A" ? audioA : audioB;
  const idleRef = active === "A" ? audioB : audioA;

  // Position ticker while playing.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const el = (active === "A" ? audioA : audioB).current;
      if (el) {
        setPosition(el.currentTime);
        if (el.duration && Number.isFinite(el.duration)) setDuration(el.duration);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [playing, active]);

  // Pause both on unmount.
  useEffect(() => {
    const a = audioA.current;
    const b = audioB.current;
    return () => {
      a?.pause();
      b?.pause();
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = activeRef.current;
    const idle = idleRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      idle?.pause();
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [playing, activeRef, idleRef]);

  // MODULAR: the A/B switch is the point — it preserves position so the
  // supervisor hears the SAME moment under both takes.
  const switchTake = useCallback((next: "A" | "B") => {
    if (next === active) return;
    const from = (active === "A" ? audioA : audioB).current;
    const to = (next === "A" ? audioA : audioB).current;
    const pos = from?.currentTime ?? 0;
    const wasPlaying = playing;
    from?.pause();
    if (to) {
      to.currentTime = pos;
      if (wasPlaying) {
        void to.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    }
    setActive(next);
  }, [active, playing]);

  const seek = useCallback((t: number) => {
    const el = activeRef.current;
    if (el) el.currentTime = t;
    setPosition(t);
  }, [activeRef]);

  const takes: Record<"A" | "B", CompareTake> = { A: a, B: b };

  return (
    <div className="mt-2 border border-[var(--color-hair)] rounded-sm bg-[var(--color-paper-2)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="shrink-0 grid h-7 w-7 place-items-center rounded-sm bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors"
        >
          {playing ? (
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
              <rect x="1" y="1" width="2.5" height="7" fill="currentColor" />
              <rect x="5.5" y="1" width="2.5" height="7" fill="currentColor" />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
              <path d="M1.5 1l6.5 3.5-6.5 3.5z" fill="currentColor" />
            </svg>
          )}
        </button>

        {/* A/B switch */}
        <div className="flex shrink-0 rounded-sm border border-[var(--color-hair-strong)] overflow-hidden" role="group" aria-label="Compare takes">
          {(["A", "B"] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => switchTake(side)}
              aria-pressed={active === side}
              title={`${takes[side].title} · fit ${takes[side].fitScore}`}
              className={cn(
                "px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors",
                active === side
                  ? "bg-[var(--color-rust)] text-[var(--color-paper)]"
                  : "text-[var(--color-ink-3)] hover:text-[var(--color-ink)]",
              )}
            >
              {side}
            </button>
          ))}
        </div>

        {/* Position bar */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration || position)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            className="flex-1 min-w-0 accent-[var(--color-rust)] h-1"
          />
          <span className="shrink-0 font-mono text-[8px] text-[var(--color-ink-3)] tabular-nums">
            {fmtTimecode(position)}{duration > 0 ? ` / ${fmtTimecode(duration)}` : ""}
          </span>
        </div>
      </div>

      {/* Active take label */}
      <p className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] truncate">
        {active} · {takes[active].title} · fit {takes[active].fitScore}
      </p>

      {/* Hidden audio elements — one per take */}
      <audio ref={audioA} src={a.audioSrc} preload="metadata" />
      <audio ref={audioB} src={b.audioSrc} preload="metadata" />
    </div>
  );
}
