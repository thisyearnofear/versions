"use client";

// SHARED: Earnings history table with filter bar, date presets, role filter,
// pagination. Used by both the artist and curator dashboards.
// Each dashboard renders its own summary cards above this table.

import { type EarningsResponse } from "@/lib/api-client";
import { PaginationControls } from "@/components/ui/PaginationControls";

// ── Types ──────────────────────────────────────────────

export type DatePreset = "today" | "7days" | "month";

// ── Helpers ────────────────────────────────────────────

export function applyDatePreset(preset: DatePreset): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const yyyyMmDd = (d: Date) => d.toISOString().slice(0, 10);
  const today = yyyyMmDd(now);

  switch (preset) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "7days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { dateFrom: yyyyMmDd(from), dateTo: today };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: yyyyMmDd(from), dateTo: today };
    }
    default:
      return { dateFrom: today, dateTo: today };
  }
}

// ── Labels ─────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  curator: "Curator fees",
  platform: "Platform share",
  musicbrainz: "Attribution",
};

// ── Component ──────────────────────────────────────────

export interface EarningsHistoryTableProps {
  earnings: EarningsResponse;
  onFetchPage: (page: number) => void;
  page: number;
  pageSize: number;
  filterRole: string;
  filterDateFrom: string;
  filterDateTo: string;
  onFilterRoleChange: (v: string) => void;
  onFilterDateFromChange: (v: string) => void;
  onFilterDateToChange: (v: string) => void;
  /** Message shown when there are no items and no filters are active. */
  emptyMessage?: string;
  /** Message shown when filters are active but no items match. */
  emptyFilteredMessage?: string;
}

export function EarningsHistoryTable({
  earnings,
  onFetchPage,
  page,
  pageSize,
  filterRole,
  filterDateFrom,
  filterDateTo,
  onFilterRoleChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  emptyMessage = "No transactions yet.",
  emptyFilteredMessage = "No transactions match the current filters.",
}: EarningsHistoryTableProps) {
  const totalItems = earnings.recent_total ?? earnings.recent.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const hasActiveFilters = filterRole || filterDateFrom || filterDateTo;

  return (
    <section className="lg:col-span-2">
      <h3 className="font-serif text-xl font-black tracking-tight mb-4">Recent transactions</h3>

      {/* ── Filter bar ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1">
          Role
        </label>
        <select
          value={filterRole}
          onChange={(e) => onFilterRoleChange(e.target.value)}
          className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)]"
        >
          <option value="">All</option>
          <option value="curator">Curator</option>
          <option value="platform">Platform</option>
          <option value="musicbrainz">Attribution</option>
        </select>

        <div className="flex items-center gap-1 ml-2 border-l border-[var(--color-hair-strong)] pl-3">
          {([
            { label: "Today", value: "today" },
            { label: "7d", value: "7days" },
            { label: "Month", value: "month" },
          ] as Array<{ label: string; value: DatePreset }>).map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                const r = applyDatePreset(p.value);
                onFilterDateFromChange(r.dateFrom);
                onFilterDateToChange(r.dateTo);
              }}
              className="font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 border border-[var(--color-hair-strong)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1 ml-3">
          From
        </label>
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => onFilterDateFromChange(e.target.value)}
          className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)] w-[140px]"
        />

        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mr-1">
          To
        </label>
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => onFilterDateToChange(e.target.value)}
          className="font-mono text-[11px] bg-[var(--color-paper)] border border-[var(--color-hair-strong)] px-3 py-1.5 text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-rust)] w-[140px]"
        />

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              onFilterRoleChange("");
              onFilterDateFromChange("");
              onFilterDateToChange("");
            }}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-rust)] ml-auto hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {totalItems === 0 ? (
        <p className="font-serif italic text-[var(--color-ink-3)] py-8 text-center border border-[var(--color-hair)]">
          {hasActiveFilters ? emptyFilteredMessage : emptyMessage}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="border-b border-[var(--color-hair-strong)]">
                  <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Date</th>
                  <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Track</th>
                  <th className="text-left py-3 pr-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Role</th>
                  <th className="text-right py-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {earnings.recent.map((e) => (
                  <tr key={`${e.submission_id}-${e.role}-${e.settled_at}`} className="border-b border-[var(--color-hair)]">
                    <td className="py-3 pr-4 text-[var(--color-ink-2)] whitespace-nowrap">
                      {e.settled_at ? new Date(e.settled_at).toLocaleDateString() : "pending"}
                    </td>
                    <td className="py-3 pr-4 truncate max-w-[200px]">
                      {e.submission_title ?? e.submission_id.slice(0, 8)}…
                    </td>
                    <td className="py-3 pr-4 text-[var(--color-ink-2)]">{ROLE_LABELS[e.role] ?? e.role}</td>
                    <td className="py-3 text-right tabular-nums font-medium">+{e.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalItems > pageSize && (
            <PaginationControls
              page={page}
              pageSize={pageSize}
              total={totalItems}
              onPrev={() => onFetchPage(Math.max(0, page - 1))}
              onNext={() => onFetchPage(Math.min(totalPages - 1, page + 1))}
              onGoTo={(p) => onFetchPage(p)}
            />
          )}
        </>
      )}
    </section>
  );
}
