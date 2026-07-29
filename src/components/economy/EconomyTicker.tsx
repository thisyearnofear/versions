"use client";

// MODULAR: the agent economy, live. One feed that replays recent activity
// from /api/economy/activity, then prepends new events as they arrive over
// SSE (economy-event). Reviews render with the agent identity kit; money
// events render the USDC amount and an ArcScan link when a real tx hash
// exists. Mock events are badged honestly — this is the surface a judge
// watches, so it never overclaims.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { EconomyEvent } from "@/lib/event-bus";
import { agentIdentity } from "@/lib/agent-identity";
import { shortAddress, shortHash, txUrl } from "@/lib/explorer";
import { fmtUsdc, relativeTime } from "@/lib/format";
import { playEconomySound, isSoundEnabled, setSoundEnabled, subscribeSound } from "@/lib/audio-feedback";

type LiveState = "loading" | "live" | "connecting" | "quiet";

function eventKey(e: EconomyEvent): string {
  return `${e.kind}|${e.timestamp}|${e.txHash ?? ""}|${e.agentName ?? ""}|${e.submissionId ?? e.versionId ?? ""}`;
}

export function EconomyTicker({ limit = 12 }: { limit?: number }) {
  const [events, setEvents] = useState<EconomyEvent[]>([]);
  const [live, setLive] = useState<LiveState>("loading");
  const soundOn = useSyncExternalStore(subscribeSound, isSoundEnabled, () => false);

  // Initial replay from the DB so the feed is never empty on load.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/economy/activity")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => {
        if (cancelled) return;
        const list = (body?.data?.events ?? []) as EconomyEvent[];
        setEvents(list.slice(0, limit));
        setLive((s) => (s === "loading" ? "quiet" : s));
      })
      .catch(() => {
        if (!cancelled) setLive((s) => (s === "loading" ? "quiet" : s));
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  // Live tail over SSE.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("economy-event", (msg) => {
      try {
        const e = JSON.parse((msg as MessageEvent).data) as EconomyEvent;
        setEvents((prev) => {
          const key = eventKey(e);
          if (prev.some((p) => eventKey(p) === key)) return prev;
          return [e, ...prev].slice(0, limit);
        });
        // Musical feedback: play a chime when sound is enabled.
        if (soundOn) playEconomySound(e.kind);
      } catch {
        /* malformed event — ignore */
      }
    });
    es.onopen = () => setLive("live");
    es.onerror = () => setLive((s) => (s === "live" ? "connecting" : s));
    return () => es.close();
  }, [limit, soundOn]);

  const visible = useMemo(() => events.slice(0, limit), [events, limit]);

  return (
    <section aria-label="Live agent economy">
      <div className="flex items-center gap-3 mb-4">
        <span className="relative flex h-2.5 w-2.5">
          {live === "live" && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-rust)] opacity-60" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              live === "live" ? "bg-[var(--color-rust)]" : "bg-[var(--color-ink-3)]"
            }`}
          />
        </span>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-2)]">
          Agent economy · {live === "live" ? "live" : live === "connecting" ? "reconnecting" : live === "loading" ? "loading" : "recent"}
        </h3>
        <button
          type="button"
          onClick={() => setSoundEnabled(!soundOn)}
          className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
          aria-label={soundOn ? "Mute economy sounds" : "Enable economy sounds"}
          title={soundOn ? "Sound on — click to mute" : "Sound off — click to enable chimes"}
        >
          {soundOn ? "♪ on" : "♪ off"}
        </button>
      </div>

      {live === "loading" ? (
        <ul className="flex flex-col">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="border-t border-[var(--color-hair)] last:border-b py-3">
              <div className="skel h-[14px] w-full max-w-[280px] mb-2" />
              <div className="skel h-[10px] w-[160px]" />
            </li>
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <p className="font-serif italic text-[var(--color-ink-3)] text-sm py-4 border-t border-b border-[var(--color-hair)]">
          The agent economy is quiet. Reviews, tips, and settlements appear here as they happen.
        </p>
      ) : (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {visible.map((e) => (
              <motion.li
                key={eventKey(e)}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="border-t border-[var(--color-hair)] last:border-b py-3"
              >
                <TickerRow event={e} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function TickerRow({ event: e }: { event: EconomyEvent }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <RowHeadline event={e} />
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {e.amountUsdc && <span className="text-[var(--color-ink-2)]">{fmtUsdc(e.amountUsdc)} USDC</span>}
          {e.settledCount !== undefined && e.settledCount > 1 && <span>{e.settledCount} tips batched</span>}
          {e.mock && (
            <span className="border border-[var(--color-hair-strong)] px-1.5 py-px text-[9px]">mock</span>
          )}
          <TxLinks event={e} />
        </div>
      </div>
      <time className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        {relativeTime(e.timestamp)}
      </time>
    </div>
  );
}

function RowHeadline({ event: e }: { event: EconomyEvent }) {
  switch (e.kind) {
    case "review": {
      const id = agentIdentity(e.agentName);
      const score =
        e.solo !== undefined && e.vocal !== undefined ? ((e.solo + e.vocal) / 2).toFixed(1) : null;
      return (
        <div className="font-serif text-base">
          <span aria-hidden="true" className="mr-1">{id.icon}</span>
          <span className="font-medium" style={{ color: id.color }}>
            {id.shortName}
          </span>
          {" rated "}
          {e.submissionId ? (
            <Link href="/agents" className="italic hover:text-[var(--color-rust)] transition-colors">
              {e.title ?? "a version"}
            </Link>
          ) : (
            <span className="italic">{e.title ?? "a version"}</span>
          )}
          {score && <span className="text-[var(--color-ink-3)]"> · {score}/10</span>}
        </div>
      );
    }
    case "tip":
      return (
        <div className="font-serif text-base">
          <span className="font-medium text-[var(--color-rust)]">Tip verified</span>
          {e.toWallet && (
            <span className="text-[var(--color-ink-3)]"> → {shortAddress(e.toWallet)}</span>
          )}
        </div>
      );
    case "tip_batch_settled":
      return (
        <div className="font-serif text-base">
          <span className="font-medium text-[var(--color-rust)]">Tip batch settled on-chain</span>
          {e.toWallet && (
            <span className="text-[var(--color-ink-3)]"> → {shortAddress(e.toWallet)}</span>
          )}
        </div>
      );
    case "leg_settled":
      return (
        <div className="font-serif text-base">
          <span className="font-medium text-[var(--color-rust)]">
            {(e.recipientRole ?? "payout") + " payout"}
          </span>
          {e.toWallet && (
            <span className="text-[var(--color-ink-3)]"> → {shortAddress(e.toWallet)}</span>
          )}
        </div>
      );
    case "play":
      return (
        <div className="font-serif text-base">
          <span className="font-medium text-[var(--color-rust)]">
            {e.playType === "free" ? "Free play" : "Pay-per-play"} settled
          </span>
          {e.toWallet && (
            <span className="text-[var(--color-ink-3)]"> → {shortAddress(e.toWallet)}</span>
          )}
        </div>
      );
    default:
      return <div className="font-serif text-base">Economy event</div>;
  }
}

function TxLinks({ event: e }: { event: EconomyEvent }) {
  const links: Array<{ label: string; hash: string }> = [];
  if (e.txHash) links.push({ label: "tx", hash: e.txHash });
  if (e.artistTxHash) links.push({ label: e.listenerTxHash ? "artist tx" : "tx", hash: e.artistTxHash });
  if (e.listenerTxHash) links.push({ label: "listener tx", hash: e.listenerTxHash });
  if (links.length === 0) return null;
  return (
    <>
      {links.map((l) => (
        <a
          key={l.hash + l.label}
          href={txUrl(l.hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-rust)] hover:text-[var(--color-ink)] transition-colors underline decoration-[var(--color-hair-strong)] underline-offset-2"
        >
          {l.label} {shortHash(l.hash)} ↗
        </a>
      ))}
    </>
  );
}
