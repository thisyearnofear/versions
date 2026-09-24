"use client";

import Link from "next/link";
import { fmtUsdc } from "@/lib/format";
import { txUrl, shortHash } from "@/lib/explorer";
import type { ChannelEarnings as Earnings } from "@/services/slots";

function splitLine(e: Earnings): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `${pct(e.split.supplier)} supplier \u00b7 ${pct(e.split.channel)} channel \u00b7 ${pct(e.split.platform)} platform`;
}

export function ChannelEarnings({
  earnings,
  loading,
  error,
  onRetry,
}: {
  earnings: Earnings | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="marketplace-kit" aria-busy="true">
        <h3 className="marketplace-heading">You keep 30%</h3>
        <p className="mt-2 font-serif text-[14px] text-[var(--color-ink-2)]">Loading your keep\u2026</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="marketplace-kit" role="alert">
        <h3 className="marketplace-heading">You keep 30%</h3>
        <p className="mt-2 font-serif text-[14px] text-[var(--color-rust)]">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-secondary mt-3">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!earnings) return null;

  const hasAny = earnings.settled.count > 0 || earnings.pending.count > 0;
  const settledClaim = earnings.settled.count > 0 ? "Settled on Arc" : null;

  return (
    <div className="marketplace-kit">
      <h3 className="marketplace-heading">You keep 30%</h3>
      <p className="mt-2 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
        Every paid placement on this channel settles flat{" "}
        <strong className="font-semibold text-[var(--color-ink)]">{splitLine(earnings)}</strong>. Your
        cut is a <code className="rounded bg-[var(--color-paper-2)] px-1 py-0.5 font-mono text-[12px]">slot_legs</code>{" "}
        paid to your channel wallet — not an estimate, the on-chain leg.
      </p>

      {!hasAny ? (
        <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] px-3 py-2.5 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
          No paid placements have settled on this channel yet. The first paid use will produce a{" "}
          <code className="font-mono text-[12px]">channel</code> leg you can verify here.
        </p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)] px-3 py-3">
            <dt className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
              Settled to this channel
            </dt>
            <dd className="mt-1 font-serif text-[18px] font-black tracking-tight text-[var(--color-ink)]">
              {fmtUsdc(earnings.settled.total_usdc)} USDC
            </dd>
            <dd className="font-mono text-[12px] text-[var(--color-ink-3)]">
              {earnings.settled.count} leg{earnings.settled.count === 1 ? "" : "s"} ·{" "}
              {settledClaim ?? "\u2014"}
            </dd>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)] px-3 py-3">
            <dt className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Pending</dt>
            <dd className="mt-1 font-serif text-[18px] font-black tracking-tight text-[var(--color-ink)]">
              {fmtUsdc(earnings.pending.total_usdc)} USDC
            </dd>
            <dd className="font-mono text-[12px] text-[var(--color-ink-3)]">
              {earnings.pending.count} leg{earnings.pending.count === 1 ? "" : "s"} · awaiting settlement
            </dd>
          </div>
        </dl>
      )}

      {earnings.recent.length > 0 && (
        <div className="mt-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
            Recent channel legs
          </p>
          <ul className="mt-2 grid gap-1.5">
            {earnings.recent.map((r) => {
              const settled = r.status === "settled" && !!r.tx_hash && !r.payment_mock;
              return (
                <li
                  key={`${r.slot_id}:${r.amount_usdc}:${r.created_at}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2"
                >
                  <span className="font-mono text-[12px] text-[var(--color-ink-2)]">
                    {fmtUsdc(r.amount_usdc)} USDC · {r.status}
                    {r.payment_mock ? " \u00b7 demo" : ""}
                  </span>
                  {r.tx_hash && !r.payment_mock && settled ? (
                    <a
                      href={txUrl(r.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-[var(--color-rust)] underline"
                    >
                      {shortHash(r.tx_hash)} on Arc
                    </a>
                  ) : (
                    <Link
                      href={`/placements/${r.slot_id}`}
                      className="font-mono text-[11px] text-[var(--color-ink-3)] underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
                    >
                      View placement
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 font-mono text-[11px] leading-snug text-[var(--color-ink-3)]">
        Amounts are summed from <code className="rounded bg-[var(--color-paper-2)] px-1">slot_legs</code> where{" "}
        <code className="rounded bg-[var(--color-paper-2)] px-1">recipient_role = &apos;channel&apos;</code> for
        this channel&apos;s slots. Only <code className="rounded bg-[var(--color-paper-2)] px-1">settled</code>{" "}
        legs have an Arc tx.
      </p>
    </div>
  );
}

export function ChannelEarningsSkeleton() {
  return (
    <div className="marketplace-kit" aria-hidden>
      <div className="h-4 w-28 animate-pulse rounded bg-[var(--color-paper-2)]" />
      <div className="mt-3 h-3 w-full animate-pulse rounded bg-[var(--color-paper-2)]" />
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="h-20 animate-pulse rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)]" />
        <div className="h-20 animate-pulse rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)]" />
      </div>
    </div>
  );
}
