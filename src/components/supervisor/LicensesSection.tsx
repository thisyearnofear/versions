"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiClient, type LicenseRow } from "@/lib/api-client";
import type { SettlementEvent } from "@/lib/event-bus";
import { useToast } from "@/components/ui/Toast";
import { Section } from "@/components/ui/primitives";
import { SettlementFanfare } from "@/components/economy/SettlementFanfare";
import { useSettlementEvents } from "@/lib/use-settlement-events";
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
  const [lastSettlement, setLastSettlement] = useState<{
    amountUsdc: string;
    mock: boolean;
    txHash: string | null;
    title: string | null;
    recipientLabel: string | null;
    jobId: string | null;
  } | null>(null);
  const licensesRef = useRef<LicenseRow[]>([]);
  const licensesLoadedRef = useRef(false);
  const pendingLicenseEventsRef = useRef<SettlementEvent[]>([]);

  const showLicenseSettlement = (event: SettlementEvent) => {
    if (event.source !== "license") return false;
    const license = licensesRef.current.find((row) => row.id === event.settlementId);
    if (!license) return false;
    const artistName = event.artistName ?? license.artist_name ?? null;
    setLastSettlement({
      amountUsdc: event.amountUsdc,
      mock: event.mock,
      txHash: event.txHash,
      title: event.title ?? license.title ?? null,
      recipientLabel: artistName ? `→ ${artistName}` : null,
      jobId: event.jobId ?? license.job_id ?? null,
    });
    return true;
  };

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      licensesLoadedRef.current = true;
      licensesRef.current = [];
      setLicenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.getLicenses({ limit: 50 });
      const nextLicenses = Array.isArray(res.rows) ? res.rows : [];
      licensesRef.current = nextLicenses;
      licensesLoadedRef.current = true;
      setLicenses(nextLicenses);
      const pendingEvents = pendingLicenseEventsRef.current;
      pendingLicenseEventsRef.current = [];
      pendingEvents.forEach(showLicenseSettlement);
    } catch (err) {
      showToast(`Licenses load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, isAuthenticated]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // A settlement from another tab or dashboard becomes the same receipt
  // fanfare as a local click, but only when this supervisor already knows
  // the license id (prevents unrelated users' licenses appearing here).
  useSettlementEvents((event) => {
    if (event.source !== "license") return;
    if (!licensesLoadedRef.current) {
      pendingLicenseEventsRef.current.push(event);
      return;
    }
    if (showLicenseSettlement(event)) void refresh();
  });

  const onPay = async (id: string) => {
    if (!requireAuth("/supervisor#licenses")) return;
    setPayingId(id);
    try {
      const res = await apiClient.payLicense(id);
      if (res.settled) {
        setLastSettlement({
          amountUsdc: res.license.fee_usdc,
          mock: res.settled.mock,
          txHash: res.settled.txHash,
          title: res.license.title ?? null,
          recipientLabel: res.license.artist_name ? `→ ${res.license.artist_name}` : null,
          jobId: res.settled.jobId ?? res.license.job_id ?? null,
        });
      }
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
          {lastSettlement && (
            <SettlementFanfare
              kind="license"
              amountUsdc={lastSettlement.amountUsdc}
              mock={lastSettlement.mock}
              txHash={lastSettlement.txHash}
              title={lastSettlement.title}
              recipientLabel={lastSettlement.recipientLabel}
              jobId={lastSettlement.jobId}
              onDismiss={() => setLastSettlement(null)}
            />
          )}
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
