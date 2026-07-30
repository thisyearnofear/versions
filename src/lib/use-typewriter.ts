"use client";

// MODULAR: client-side typewriter reveal. The server emits complete,
// honest verdicts over SSE; this hook owns the dramatic pacing so mock
// mode (near-instant LLM calls) still reads as agents "thinking".
// Reduced motion → instant full text.

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const TICK_MS = 30;

// Pure pacing math, exported for unit tests: characters revealed per
// TICK_MS interval at a given characters-per-second rate (min 1).
export { TICK_MS };
export function charsPerTick(cps: number): number {
  return Math.max(1, Math.round(cps * (TICK_MS / 1000)));
}

export function useTypewriter(
  text: string,
  opts?: { cps?: number; enabled?: boolean; onDone?: () => void },
): { display: string; done: boolean; skip: () => void } {
  const cps = opts?.cps ?? 55;
  const enabled = opts?.enabled ?? true;
  const reducedMotion = useReducedMotion();
  const instant = reducedMotion === true;

  const [count, setCount] = useState(0);
  const onDoneRef = useRef(opts?.onDone);
  const firedRef = useRef(false);
  const onDone = opts?.onDone;
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCount(0);
    firedRef.current = false;
  }, [text]);

  useEffect(() => {
    if (!enabled) return;
    if (instant) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(text.length);
      return;
    }
    if (text.length === 0) return;
    const step = charsPerTick(cps);
    const timer = setInterval(() => {
      setCount((c) => {
        const next = Math.min(text.length, c + step);
        if (next >= text.length) clearInterval(timer);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [text, cps, enabled, instant]);

  const done = enabled && count >= text.length;

  useEffect(() => {
    if (done && !firedRef.current) {
      firedRef.current = true;
      onDoneRef.current?.();
    }
  }, [done]);

  return {
    display: enabled ? text.slice(0, count) : "",
    done,
    skip: () => setCount(text.length),
  };
}
