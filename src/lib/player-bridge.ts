// MODULAR: client-side playing-track bridge. A single module-level
// source of truth for "which track is currently playing" so any
// surface can react without prop-drilling — the FeedView vinyl spins
// while its track plays, taste-graph radars could pulse, etc.
//
// Only ONE track can play at a time across the app (browsers stop the
// previous <audio> when another starts), so the bridge is a single
// string key (submission_id / playlist track id) + null when paused.
// Last-writer-wins: starting a new track replaces the previous key.
//
// No persistence, no SSR concerns — guards typeof window.

import { useSyncExternalStore } from "react";

type Listener = (key: string | null) => void;

let currentKey: string | null = null;
const listeners = new Set<Listener>();

export function getPlayingTrackKey(): string | null {
  return currentKey;
}

export function setPlayingTrackKey(key: string | null): void {
  if (currentKey === key) return;
  currentKey = key;
  listeners.forEach((fn) => {
    try {
      fn(currentKey);
    } catch {
      // listener errors must not break the bridge
    }
  });
}

/** Subscribe to playing-track changes; returns an unsubscribe fn. */
export function subscribePlayingTrack(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: returns the currently-playing track key (re-renders on change). */
export function usePlayingTrackKey(): string | null {
  return useSyncExternalStore(subscribePlayingTrack, getPlayingTrackKey, () => null);
}
