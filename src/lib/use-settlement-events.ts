"use client";

// MODULAR: one browser-side settlement stream per tab. Ticker, stats,
// receipts, licensing, and tip surfaces can all subscribe without opening
// one EventSource per component. The server remains the source of truth;
// this module only fans the typed SSE event out to mounted listeners.

import { useEffect, useRef } from "react";
import type { SettlementEvent } from "@/lib/event-bus";

const listeners = new Set<(event: SettlementEvent) => void>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUs = false;

function isSettlementEvent(value: unknown): value is SettlementEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SettlementEvent>;
  const validSource =
    event.source === "license" ||
    event.source === "tip" ||
    event.source === "split" ||
    event.source === "play";
  return (
    event.type === "settled" &&
    validSource &&
    typeof event.settlementId === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.amountUsdc === "string" &&
    (typeof event.txHash === "string" || event.txHash === null) &&
    typeof event.mock === "boolean"
  );
}

function scheduleReconnect() {
  if (closedByUs || retryTimer || listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 3000);
}

function connect() {
  if (typeof window === "undefined" || source || listeners.size === 0) return;
  closedByUs = false;
  source = new EventSource("/api/events");
  source.addEventListener("settlement-event", (message) => {
    try {
      const parsed: unknown = JSON.parse((message as MessageEvent).data);
      if (!isSettlementEvent(parsed)) return;
      for (const listener of listeners) {
        try {
          listener(parsed);
        } catch {
          // One dashboard listener must not break the shared stream.
        }
      }
    } catch {
      // Malformed payloads are ignored; the connection stays useful.
    }
  });
  source.onerror = () => {
    source?.close();
    source = null;
    scheduleReconnect();
  };
}

function disconnectIfIdle() {
  if (listeners.size > 0) return;
  closedByUs = true;
  source?.close();
  source = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function subscribeSettlementEvents(listener: (event: SettlementEvent) => void): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
}

/** Subscribe a component without forcing it to manage EventSource lifecycle. */
export function useSettlementEvents(onEvent: (event: SettlementEvent) => void): void {
  const callbackRef = useRef(onEvent);
  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    return subscribeSettlementEvents((event) => callbackRef.current(event));
  }, []);
}
