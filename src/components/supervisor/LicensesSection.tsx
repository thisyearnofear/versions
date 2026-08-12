"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type LicenseRow } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Section } from "@/components/ui/primitives";
import { jobUrl, shortHash, txUrl } from "@/lib/explorer";

const USAGE_LABELS: Record<LicenseRow["usage_type"], string> = {
  sync_ad: "Sync · Ad",
  sync_tv_film: "Sync · TV/Film",
  sync_digital: "Sync · Digital",
  other: "Other",
};

export function LicensesSection({
  isAuthenticated,
  requireAuth,
}: {
  isAuthenticated: boolean;
  requireAuth: (returnTo?: string) => boolean;
}) {
  const { showToast } = useToast();
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setLicenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.getLicenses({ limit: 50 });
      setLicenses(Array.isArray(res.rows) ? res.rows : []);
    } catch (err) {
      showToast(`Licenses load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onPay = async (id: string) => {
    if (!requireAuth("/supervisor#licenses")) return;
    setPayingId(id);
    try {
      const res = await apiClient.payLicense(id);
      const jobNote = res.settled?.jobId ? ` · ERC-8183 job #${res.settled.jobId}` : "";
      showToast(
        res.settled?.mock
          ? `Settled (mock)${jobNote}`
          : `License paid on Arc${jobNote}`,
        "success",
      );
      await refresh();
    } catch (err) {
      showToast(`Settlement failed: ${(err as Error).message}`, "error");
    } finally {
      setPayingId(null);
    }
  };

  const pending = licenses.filter((l) => l.status === "pending_payment");
  const paid = licenses.filter((l) => l.status === "paid");

  return (
    <Section
      eyebrow="Settlement · ERC-8183"
      title="Licenses"
      intro={
        isAuthenticated
          ? "Each license is an Agentic Commerce job: escrow → deliverable → complete on Arc."
          : undefined
      }
      className="py-8"
    >
      {!isAuthenticated ? (
        <p className="font-serif text-sm text-[var(--color-ink-2)]">
          Sign in to view and settle licenses.{" "}
          <Link href="/discover" className="text-[var(--color-rust)] hover:underline">
            Search catalog →
          </Link>
        </p>
      ) : loading ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">Loading…</p>
      ) : licenses.length === 0 ? (
        <p className="font-serif text-sm text-[var(--color-ink-2)]">
          No licenses yet. Shortlist a match on{" "}
          <Link href="/discover" className="text-[var(--color-rust)] hover:underline">
            Discover
          </Link>
          , pick a usage type, and request a license.
        </p>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-rust)] mb-2">
                Pending settlement · {pending.length}
              </p>
              <ul className="space-y-2">
                {pending.map((l) => (
                  <LicenseRowItem key={l.id} license={l} paying={payingId === l.id} onPay={() => void onPay(l.id)} />
                ))}
              </ul>
            </div>
          )}
          {paid.length > 0 && (
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-2">
                Settled · {paid.length}
              </p>
              <ul className="space-y-2">
                {paid.map((l) => (
                  <LicenseRowItem key={l.id} license={l} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function LicenseRowItem({
  license: l,
  paying,
  onPay,
}: {
  license: LicenseRow;
  paying?: boolean;
  onPay?: () => void;
}) {
  const isPending = l.status === "pending_payment";

  return (
    <li>
      <div className="border border-[var(--color-hair)] rounded-sm p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-[var(--color-ink-3)] transition-colors">
        <div className="min-w-0">
          <p className="font-serif text-[14px] font-medium truncate">
            {l.title ?? "Untitled"}
            <span className="text-[var(--color-ink-3)] font-normal"> · {l.artist_name ?? "Unknown"}</span>
          </p>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] mt-0.5">
            {USAGE_LABELS[l.usage_type]} · ${l.fee_usdc} USDC · {l.territory} · {l.term_months} mo
            <span className={isPending ? " ml-2 text-[var(--color-ink)]" : " ml-2 text-[var(--color-rust)]"}>
              {isPending ? (l.job_status ?? "OPEN") : "COMPLETED"}
            </span>
          </p>
          {l.job_id && (
            <p className="mt-1 font-mono text-[9px] text-[var(--color-ink-3)]">
              ERC-8183 job #{l.job_id}{" "}
              <a
                href={jobUrl(l.job_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--color-rust)]"
              >
                ArcScan ↗
              </a>
              {l.job_complete_tx_hash && (
                <>
                  {" · "}
                  <a
                    href={txUrl(l.job_complete_tx_hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[var(--color-rust)]"
                  >
                    complete {shortHash(l.job_complete_tx_hash)}
                  </a>
                </>
              )}
              {l.payment_mock ? " · mock" : ""}
            </p>
          )}
          {!isPending && l.payment_tx_hash && (
            <a
              href={txUrl(l.payment_tx_hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9px] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] mt-0.5 inline-block"
            >
              artist payout {shortHash(l.payment_tx_hash)}
              {l.payment_mock ? " (mock)" : ""} ↗
            </a>
          )}
        </div>
        {isPending && onPay ? (
          <button
            type="button"
            onClick={onPay}
            disabled={paying}
            className="shrink-0 bg-[var(--color-rust)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {paying ? "Settling…" : `Settle · $${l.fee_usdc}`}
          </button>
        ) : !isPending ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            On Arc ✓
          </span>
        ) : null}
      </div>
    </li>
  );
}
