"use client";

import { useCallback, useState } from "react";
import { mediaHref, uploadAudioHref } from "@/lib/marketplace-client";
import { cn } from "@/lib/utils";

function safeLinkHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function PublishingKit({
  attributionText,
  trackingUrl,
  linkLabel = "Tracking link",
  disclosure,
  audioPath,
  images,
  reportHint = true,
}: {
  attributionText: string;
  trackingUrl?: string | null;
  linkLabel?: "Attribution link" | "Tracking link";
  disclosure?: { label: string; statement: string } | null;
  audioPath?: string | null;
  images?: string[];
  reportHint?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(attributionText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, [attributionText]);

  const safeTrackingUrl = safeLinkHref(trackingUrl);

  const mediaLinks: Array<{ label: string; href: string }> = [];
  if (audioPath) mediaLinks.push({ label: "Audio file", href: uploadAudioHref(audioPath) });
  for (const [i, raw] of (images ?? []).entries()) {
    const href = mediaHref(raw);
    if (href) mediaLinks.push({ label: `Image ${i + 1}`, href });
  }

  return (
    <section className="marketplace-kit" aria-label="Publishing kit">
      <h3 className="marketplace-heading">Publishing kit</h3>

      <div className="mt-3">
        <p className="marketplace-label">Attribution — render this credit exactly as written</p>
        <p className="mt-1 select-all break-words rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper)] px-3 py-2.5 font-mono text-[13px] leading-snug text-[var(--color-ink)]">
          {attributionText}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void copy()} className="btn-secondary">
            Copy credit
          </button>
          <span aria-live="polite" className="font-mono text-[12px] text-[var(--color-ink-2)]">
            {copyStatus === "copied" && "Copied."}
            {copyStatus === "failed" && (
              <>Copy failed — select the credit text above and copy it manually.</>
            )}
          </span>
        </div>
      </div>

      {safeTrackingUrl && (
        <p className="mt-3 font-mono text-[12px] leading-snug text-[var(--color-ink-2)]">
          {linkLabel}:{" "}
          <a href={safeTrackingUrl} className="break-all text-[var(--color-rust)] underline">
            {safeTrackingUrl}
          </a>
        </p>
      )}

      {disclosure && (
        <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-rust)]/40 bg-[var(--color-rust-soft)] px-3 py-2 font-serif text-[14px] leading-snug text-[var(--color-ink)]">
          <strong className="font-semibold">{disclosure.label}</strong> — {disclosure.statement}
        </p>
      )}

      {mediaLinks.length > 0 && (
        <div className="mt-3">
          <p className="marketplace-label">Media</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {mediaLinks.map((m) => (
              <li key={m.href}>
                <a
                  href={m.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex min-h-[44px] items-center rounded-full border border-[var(--color-hair-strong)] px-4",
                    "font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                  )}
                >
                  {m.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 font-mono text-[12px] text-[var(--color-ink-3)]">
        Covered by the{" "}
        <a href="/legal/agreement" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
          blanket agreement
        </a>
        . Copying the credit does not log a use{reportHint ? " — report where it ran below" : ""}.
      </p>
    </section>
  );
}
