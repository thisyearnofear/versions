"use client";

// MODULAR: the "agents paid me" receipts feed. Self-contained — owns its
// fetch, pagination, source filter, and SSE refresh — so mounting it in a
// dashboard tab is a one-line change. Pure display logic (labels, amount
// formatting, wallet matching) lives in src/lib/receipts.ts for testing.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  apiClient,
  type ReceiptRowResponse,
  type ReceiptSource,
  type ReceiptsResponse,
} from "@/lib/api-client";
import { SOURCE_LABELS, formatReceiptAmount, receiptMatchesWallet } from "@/lib/receipts";
import { shortAddress, shortHash, txUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";
import { useSettlementEvents } from "@/lib/use-settlement-events";

const PAGE_SIZE = 20;
const SOURCES: ReceiptSource[] = ["split", "tip", "play"];

export function ReceiptsFeed({ wallet }: { wallet: string }) {
  const [data, setData] = useState<ReceiptsResponse | null>(null);
  const [rows, setRows] = useState<ReceiptRowResponse[]>([]);
  const [source, setSource] = useState<ReceiptSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    async (offset: number, src: ReceiptSource | null, append: boolean) => {
      try {
        const res = await apiClient.getArtistReceipts(wallet, {
          limit: PAGE_SIZE,
          offset,
          ...(src ? { source: src } : {}),
        });
        setData(res);
        setRows((prev) => {
          if (!append) return res.rows;
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...res.rows.filter((r) => !seen.has(r.id))];
        });
      } catch {
        // keep whatever is on screen; next SSE refresh retries
      }
    },
    [wallet],
  );

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchPage(0, source, false).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, source]);

  const queueRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchPage(0, source, false);
    }, 500);
  }, [fetchPage, source]);

  // Canonical settlement stream: artist receipt sources represented by
  // this feed (tips, splits, plays) re-fetch page 0 without opening
  // another EventSource. License receipts render in LicensesSection,
  // whose supervisor-scoped list has the ERC-8183 context this feed lacks.
  useSettlementEvents((event) => {
    if (
      event.source !== "license" &&
      receiptMatchesWallet(event as unknown as Record<string, unknown>, wallet)
    ) {
      queueRefresh();
    }
  });

  // Compatibility refresh for older event producers and verified tips.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const onPayment = (raw: MessageEvent) => {
      try {
        const evt = JSON.parse(raw.data) as Record<string, unknown>;
        if (!receiptMatchesWallet(evt, wallet)) return;
      } catch {
        return;
      }
      queueRefresh();
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.addEventListener("economy-event", onPayment);
      es.addEventListener("tip-received", onPayment);
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [wallet, fetchPage, source, queueRefresh]);

  const totalRows = data?.total_rows ?? 0;
  const hasMore = rows.length < totalRows;

  const onLoadMore = async () => {
    setLoadingMore(true);
    await fetchPage(rows.length, source, true);
    setLoadingMore(false);
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Agents paid me
        </h3>
        <div className="flex gap-2">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource((cur) => (cur === s ? null : s))}
              aria-pressed={source === s}
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border transition-colors",
                source === s
                  ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                  : "border-[var(--color-hair)] text-[var(--color-ink-3)] hover:text-[var(--color-ink)]",
              )}
            >
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          {(
            [
              ["Splits", data.totals.splits, data.counts.splits],
              ["Tips", data.totals.tips, data.counts.tips],
              ["Plays", data.totals.plays, data.counts.plays],
            ] as const
          ).map(([label, total, count]) => (
            <div key={label} className="border border-[var(--color-hair-strong)] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">
                {label}
              </div>
              <div className="font-serif text-xl font-black tabular-nums">
                {total.toFixed(total < 0.01 && total > 0 ? 4 : 2)}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-1">
                {count} payment{count !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] py-6">
          Loading receipts…
        </p>
      ) : rows.length === 0 ? (
        <p className="border border-[var(--color-hair)] p-6 font-serif italic text-sm text-[var(--color-ink-2)]">
          No receipts yet — publish a version or share your tip link, and every
          payment lands here with its on-chain hash.
        </p>
      ) : (
        <ul>
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.li
                key={r.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="border-b border-[var(--color-hair)] py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em]",
                        r.source === "tip" ? "text-[var(--color-rust)]" : "text-[var(--color-ink-3)]",
                      )}
                    >
                      {SOURCE_LABELS[r.source]}
                      {r.detail && r.source === "split" ? ` · ${r.detail}` : ""}
                    </span>
                    <div className="font-serif text-sm truncate">
                      {r.title ?? (r.counterparty ? shortAddress(r.counterparty) : "—")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-serif tabular-nums font-medium">
                      {formatReceiptAmount(r.amount_usdc)}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                      {r.occurred_at ? new Date(r.occurred_at).toLocaleDateString() : ""}
                    </div>
                  </div>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] mt-1 flex flex-wrap gap-x-3">
                  {r.tx_hash && (
                    <a
                      href={txUrl(r.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-rust)] hover:text-[var(--color-ink)] transition-colors underline decoration-[var(--color-hair-strong)] underline-offset-2"
                    >
                      tx {shortHash(r.tx_hash)} ↗
                    </a>
                  )}
                  {r.source === "tip" && r.status === "verified" && (
                    <span className="text-[var(--color-ink-3)]">settling…</span>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] border border-[var(--color-hair-strong)] px-4 py-2 transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : `Load more (${rows.length} of ${totalRows})`}
        </button>
      )}
    </div>
  );
}
