"use client";

// MODULAR: Licenses panel for the supervisor dashboard. Lists licenses the
// supervisor opened from matched takes, lets them settle (pay) an unpaid
// one, and links paid ones to ArcScan. This is the "licensed outcome"
// surfaced on the supervisor side: pending_payment → paid with an on-chain
// receipt (mock-flagged when Arc isn't configured, consistent with the
// rest of the demo loop).

import { useCallback, useEffect, useState } from "react";
import { apiClient, type LicenseRow } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { txUrl } from "@/lib/explorer";

const USAGE_LABELS: Record<LicenseRow["usage_type"], string> = {
  sync_ad: "Sync · Ad",
  sync_tv_film: "Sync · TV/Film",
  sync_digital: "Sync · Digital",
  other: "Other",
};

export function LicensesSection() {
  const { showToast } = useToast();
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.getLicenses({ limit: 50 });
      setLicenses(Array.isArray(res.rows) ? res.rows : []);
    } catch (err) {
      showToast(`Licenses load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onPay = async (id: string) => {
    setPayingId(id);
    try {
      const res = await apiClient.payLicense(id);
      showToast(
        res.settled?.mock ? "Settled (mock) — license paid" : "License paid & settled on Arc",
        "success",
      );
      await refresh();
    } catch (err) {
      showToast(`Settlement failed: ${(err as Error).message}`, "error");
    } finally {
      setPayingId(null);
    }
  };

  return (
    <section className="border-t border-[var(--color-ink)] pt-8">
      <h3 className="mb-1 font-serif text-2xl font-black tracking-tight">Licenses</h3>
      <p className="mb-4 font-serif text-sm text-[var(--color-ink-3)]">
        Your settled licensing outcomes from matched takes.
      </p>

      {loading ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">Loading…</p>
      ) : licenses.length === 0 ? (
        <p className="font-serif text-[var(--color-ink-2)]">
          No licenses yet. When a returned match fits, license the take from the discover cards.
        </p>
      ) : (
        <ul className="flex flex-col">
          {licenses.map((l) => (
            <li
              key={l.id}
              className="border-t border-[var(--color-hair)] last:border-b py-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-serif text-base font-medium">
                  {l.title ?? "Untitled"} <span className="text-[var(--color-ink-3)]">·</span>{" "}
                  {l.artist_name ?? "Unknown artist"}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                  {USAGE_LABELS[l.usage_type]} · ${l.fee_usdc} USDC · {l.territory} · {l.term_months} mo
                  <span className={l.status === "paid" ? "ml-2 text-[var(--color-rust)]" : "ml-2 text-[var(--color-ink)]"}>
                    {l.status === "paid" ? "PAID" : "PENDING"}
                  </span>
                </p>
                {l.status === "paid" && l.payment_tx_hash && (
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
                    {l.id.slice(0, 8)}… ·{" "}
                    <a
                      href={txUrl(l.payment_tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--color-rust)]"
                    >
                      {l.payment_tx_hash.slice(0, 10)}…{l.payment_mock ? " (mock)" : ""} ↗
                    </a>
                  </p>
                )}
              </div>
              {l.status === "pending_payment" ? (
                <button
                  type="button"
                  onClick={() => void onPay(l.id)}
                  disabled={payingId === l.id}
                  className="bg-[var(--color-ink)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
                >
                  {payingId === l.id ? "Settling…" : "Settle"}
                </button>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                  Settled on Arc
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}