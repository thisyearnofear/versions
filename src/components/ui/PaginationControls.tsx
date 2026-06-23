"use client";

// MODULAR: Shared pagination controls — prev/next buttons, compact page
// numbers with ellipsis for large page counts, and a range summary.
// Used by listener play history, artist earnings, and curator earnings.

import { cn } from "@/lib/utils";

export interface PaginationControlsProps {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (page: number) => void;
}

export function PaginationControls({
  page,
  pageSize,
  total,
  loading = false,
  onPrev,
  onNext,
  onGoTo,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  // Build a compact page number list with ellipsis
  const pages: Array<number | "ellipsis"> = [];
  const maxVisible = 5;
  if (totalPages <= maxVisible + 2) {
    for (let i = 0; i < totalPages; i++) pages.push(i);
  } else {
    pages.push(0);
    if (page > 2) pages.push("ellipsis");
    const startPage = Math.max(1, page - 1);
    const endPage = Math.min(totalPages - 2, page + 1);
    for (let i = startPage; i <= endPage; i++) pages.push(i);
    if (page < totalPages - 3) pages.push("ellipsis");
    pages.push(totalPages - 1);
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-2 pt-6 border-t border-[var(--color-hair)] mt-6"
    >
      {/* Prev */}
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 0 || loading}
        className="font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-2 border border-[var(--color-hair-strong)] hover:border-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        ← Prev
      </button>

      {/* Page numbers */}
      <div className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`e-${i}`}
              className="font-mono text-[11px] text-[var(--color-ink-3)] px-1 select-none"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onGoTo(p)}
              disabled={loading}
              className={cn(
                "font-mono text-[11px] min-w-[28px] h-8 flex items-center justify-center border transition-colors",
                p === page
                  ? "border-[var(--color-rust)] bg-[var(--color-rust)]/10 text-[var(--color-rust)] font-semibold"
                  : "border-transparent text-[var(--color-ink-2)] hover:border-[var(--color-hair-strong)] hover:text-[var(--color-ink)]",
              )}
            >
              {p + 1}
            </button>
          ),
        )}
      </div>

      {/* Next */}
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages - 1 || loading}
        className="font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-2 border border-[var(--color-hair-strong)] hover:border-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Next →
      </button>

      {/* Summary */}
      <span className="font-mono text-[10px] text-[var(--color-ink-3)] ml-2 whitespace-nowrap">
        {start}–{end} of {total}
      </span>
    </nav>
  );
}
