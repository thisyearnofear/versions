"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { mediaHref, uploadAudioHref } from "@/lib/marketplace-client";
import { sanitizeCoverSvg } from "@/lib/cover-sanitize";
import { cn } from "@/lib/utils";

export function ListingMedia({
  title,
  kind,
  audioPath,
  images,
  coverSvg,
  compact = false,
  priority = false,
  fallbackTitle = true,
}: {
  title: string;
  kind: "music" | "placement";
  audioPath?: string | null;
  images?: string[] | null;
  coverSvg?: string | null;
  compact?: boolean;
  priority?: boolean;
  /* When false, the no-media fallback tile drops the title — for surfaces
     (like the landing stage) that render the title directly beneath. */
  fallbackTitle?: boolean;
}) {
  const imageUrls = useMemo(
    () => (images ?? []).map(mediaHref).filter((u): u is string => !!u),
    [images],
  );
  const safeCover = useMemo(() => (coverSvg ? sanitizeCoverSvg(coverSvg) : null), [coverSvg]);
  const audioUrl = audioPath ? uploadAudioHref(audioPath) : null;

  const coverSrc = safeCover
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeCover)}`
    : null;
  const src = imageUrls[0] ?? coverSrc;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <figure className="m-0" aria-label={`${title} media`}>
      {src && src !== failedSrc ? (
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)]",
            compact ? "aspect-[16/9]" : "aspect-[4/3]",
          )}
        >
          <Image
            key={src}
            src={src}
            alt={`${title} cover`}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            unoptimized
            priority={priority}
            loading={priority ? "eager" : "lazy"}
            onError={() => setFailedSrc(src)}
            className="object-contain"
          />
        </div>
      ) : (
        <div
          className={cn(
            "flex items-end rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] p-4",
            compact ? "aspect-[16/9]" : "aspect-[4/3]",
          )}
        >
          <div className="min-w-0">
            <svg viewBox="0 0 64 64" className="mb-2 h-7 w-7 opacity-40" aria-hidden="true">
              <path d="M20 18 L32 46 L44 18" fill="none" stroke="#c84a1f" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" transform="translate(3.5 2)" opacity="0.6" />
              <path d="M20 18 L32 46 L44 18" fill="none" stroke="#1a1a1a" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
              {kind === "music" ? "Track" : "Placement"}
            </p>
            {fallbackTitle && (
              <p className="truncate font-serif text-lg font-bold leading-tight text-[var(--color-ink)]">{title}</p>
            )}
          </div>
        </div>
      )}
      {audioUrl && (
        <audio key={audioUrl} controls preload="none" src={audioUrl} className="mt-3 w-full">
          Your browser does not support audio playback.
        </audio>
      )}
    </figure>
  );
}
