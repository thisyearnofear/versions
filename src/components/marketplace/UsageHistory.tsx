"use client";

import { mediaHref, type UsageRecord } from "@/lib/marketplace-client";

const REPORTER_LABELS: Record<string, string> = {
  channel: "Channel-reported",
  platform_api: "Platform-verified",
  manual: "Manual entry",
};

export function UsageHistory({ usage }: { usage: UsageRecord[] }) {
  if (usage.length === 0) {
    return (
      <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
        No deliveries logged yet.
      </p>
    );
  }
  return (
    <ul className="grid gap-2" aria-label="Delivery history">
      {usage.map((u) => {
        const video = u.video_url ? mediaHref(u.video_url) : null;
        return (
          <li
            key={u.id}
            className="rounded-[var(--radius-md)] border border-[var(--color-hair)] px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-serif text-[14px] font-semibold text-[var(--color-ink)]">
                {new Date(u.occurred_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                {" · "}
                {u.kind === "sponsored" ? "Sponsored delivery" : "Free use"}
              </span>
              <span className="font-mono text-[12px] text-[var(--color-ink-3)]">
                {REPORTER_LABELS[u.reported_by] ?? u.reported_by}
              </span>
            </div>
            <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-2)]">
              {u.impressions.toLocaleString()} impressions · {u.clicks.toLocaleString()} clicks
              {u.spend_usdc !== "0" ? ` · ${u.spend_usdc} USDC` : " · no spend"}
            </p>
            {video && (
              <a
                href={video}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block break-all font-mono text-[12px] text-[var(--color-rust)] underline"
              >
                {video}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
