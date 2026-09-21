"use client";

// MODULAR: the landing one-button demo is a zero-write tour of the real
// placement rails, using only the public read APIs: paid supply → logged
// delivery (honest by_reporter split) → platform-verified reach → the
// placement's 60/30/10 legs → the attribution string a free use must
// render unmodified. Nothing is created, signed, or spent — buying a
// placement requires a signed-in operator on a verified channel, and a
// demo that laundered mock reach to fake one would break the exact
// claim discipline this page makes.

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { setSoundEnabled } from "@/lib/audio-feedback";
import { track } from "@/lib/analytics";
import { shortAddress, shortHash, txUrl } from "@/lib/explorer";
import { fmtUsdc, relativeTime } from "@/lib/format";

type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";

interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
}

const STEP_LABELS = ["Paid supply", "Delivery log", "Verified reach", "Settlement", "Attribution"] as const;

function initialSteps(): Step[] {
  return STEP_LABELS.map((label) => ({ label, status: "pending" }));
}

interface SearchRow {
  id: string;
  title: string;
  supplier_name: string;
  tier: string;
  attribution_text: string;
}

interface UsageRow {
  id: string;
  listing_id: string;
  channel_id: string;
  slot_id: string | null;
  kind: string;
  impressions: number;
  clicks: number;
  spend_usdc: string;
  reported_by: string;
  occurred_at: string;
}

interface ChannelRow {
  id: string;
  name: string;
  verification_status: string;
  can_buy_slots: boolean;
  stats: { subscriber_count: number | null; view_count: string | null; source: string | null };
}

interface SlotRow {
  id: string;
  status: string;
  spent_usdc: string;
  payment_tx_hash: string | null;
  payment_mock: boolean;
}

interface LegRow {
  recipient_role: string;
  recipient_wallet: string;
  amount_usdc: string;
  status: string;
  tx_hash: string | null;
}

interface Proof {
  listing: SearchRow;
  usage: UsageRow[];
  reporterSplit: Record<string, number>;
  channel: ChannelRow | null;
  slot: SlotRow | null;
  legs: LegRow[];
}

// The public routes all answer { success, data }; unwrap tolerantly.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `${url.split("?")[0]} failed (${res.status})`);
  }
  return ((json?.data ?? json) as T);
}

export function LiveDemoButton() {
  const [steps, setSteps] = useState<Step[]>(initialSteps());
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const runningRef = useRef(false);

  function setStep(i: number, status: StepStatus, detail?: string) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s)));
  }

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setSteps(initialSteps());
    setError(null);
    setProof(null);
    setPhase("running");
    setSoundEnabled(true); // ticker chimes on — this click is the required user gesture
    track("demo_run", { source: "landing" });

    let failedStep = 0;
    try {
      // Step 1 — the paid side of the catalog, live.
      failedStep = 0;
      setStep(0, "active");
      const search = await getJson<{ rows: SearchRow[]; mode: string }>("/api/v1/marketplace/search?tier=paid&limit=8");
      const paid = search.rows ?? [];
      if (paid.length === 0) throw new Error("no paid supply in this database — run npm run seed:marketplace");
      setStep(0, "done", `${paid.length} paid listings live`);

      // Step 2 — find a placement that actually got used, and show who
      // reported it. Channel-reported delivery is never laundered into
      // "verified", so the split is printed as-is.
      failedStep = 1;
      setStep(1, "active");
      let listing: SearchRow | null = null;
      let usage: UsageRow[] = [];
      for (const row of paid.slice(0, 4)) {
        const rows = await getJson<{ usage: UsageRow[] }>(`/api/v1/usage?listingId=${encodeURIComponent(row.id)}&limit=10`);
        if ((rows.usage ?? []).length > 0) {
          listing = row;
          usage = rows.usage;
          break;
        }
      }
      if (!listing) throw new Error("paid supply exists but nothing has been used yet — check back after a delivery");
      const split: Record<string, number> = {};
      for (const u of usage) split[u.reported_by] = (split[u.reported_by] ?? 0) + 1;
      const splitText = Object.entries(split)
        .map(([who, n]) => `${who}×${n}`)
        .join(" · ");
      const showcase = usage.find((u) => u.slot_id) ?? usage[0];
      setStep(1, "done", `${usage.length} events · reported ${splitText}`);

      // Step 3 — the channel's reach is only worth anything if the
      // platform confirmed it. Unverified channels are hidden by the API,
      // which this step renders as an honest note, not a failure.
      failedStep = 2;
      setStep(2, "active");
      let channel: ChannelRow | null = null;
      try {
        const res = await getJson<{ channel: ChannelRow }>(`/api/v1/channels/${encodeURIComponent(showcase.channel_id)}`);
        channel = res.channel ?? null;
      } catch {
        channel = null;
      }
      if (channel) {
        const reach =
          channel.stats?.subscriber_count != null
            ? `${channel.stats.subscriber_count.toLocaleString()} subs`
            : channel.stats?.view_count != null
              ? `${Number(channel.stats.view_count).toLocaleString()} views`
              : "reach on file";
        setStep(2, "done", `${channel.name} · ${reach} · ${channel.stats?.source ?? channel.verification_status}`);
      } else {
        setStep(2, "skipped", "channel not publicly verified");
      }

      // Step 4 — the money truth: the slot's legs. Mock settles are badged
      // mock; only a leg tx hash links out.
      failedStep = 3;
      let slot: SlotRow | null = null;
      let legs: LegRow[] = [];
      if (showcase.slot_id) {
        setStep(3, "active");
        const res = await getJson<{ slot: SlotRow; legs: LegRow[] }>(`/api/v1/slots/${encodeURIComponent(showcase.slot_id)}`);
        slot = res.slot ?? null;
        legs = res.legs ?? [];
        const settled = slot?.status === "settled" || slot?.status === "completed";
        const rail = slot?.payment_mock ? "mock rail" : legs.some((l) => l.tx_hash) ? "on Arc" : "pending";
        setStep(3, "done", `${slot ? fmtUsdc(slot.spent_usdc) : "—"} USDC · ${legs.length} legs ${settled ? `settled ${rail}` : `(${slot?.status ?? "?"})`}`);
      } else {
        setStep(3, "skipped", "this use was free — nothing to settle");
      }

      // Step 5 — the wedge: credit is the price of free.
      setStep(4, "done", "rendered below, unmodified");

      setProof({ listing, usage, reporterSplit: split, channel, slot, legs });
      setPhase("done");
    } catch (e) {
      setStep(failedStep, "failed", e instanceof Error ? e.message : String(e));
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }

  return (
    <div className="text-center">
      <button
        type="button"
        onClick={run}
        disabled={phase === "running"}
        className="inline-flex min-h-[44px] items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-ink)] px-6 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] shadow-[var(--shadow-soft)] transition-all hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] hover:shadow-[var(--shadow-lift)] disabled:cursor-wait disabled:opacity-50 sm:px-8"
      >
        {phase === "running" ? (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-rust)] animate-pulse" aria-hidden="true" />
            Tracing a placement…
          </>
        ) : phase === "done" ? (
          <>↻ Trace another</>
        ) : (
          <>▶ Watch a placement settle — live</>
        )}
      </button>
      <p className="kicker mt-3">
        Reads the live rails · no sign-in · nothing created or spent
      </p>

      <AnimatePresence>
        {phase !== "idle" && (
          <motion.ol
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 flex flex-col gap-2 text-left"
            aria-label="Live demo progress"
          >
            {steps.map((s, i) => (
              <li key={s.label} className="flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                <span
                  aria-hidden="true"
                  className={
                    s.status === "done"
                      ? "text-[var(--color-rust)]"
                      : s.status === "failed"
                        ? "text-red-600"
                        : s.status === "active"
                          ? "text-[var(--color-ink)]"
                          : "text-[var(--color-ink-3)]"
                  }
                >
                  {s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "skipped" ? "–" : s.status === "active" ? "●" : `0${i + 1}`}
                </span>
                <span className={s.status === "pending" ? "text-[var(--color-ink-3)]" : "text-[var(--color-ink)]"}>{s.label}</span>
                {s.detail && s.status !== "pending" && (
                  <span className="normal-case tracking-normal text-[var(--color-ink-3)]">· {s.detail}</span>
                )}
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>

      {proof && (
        <div className="mt-5 space-y-3 text-left">
          <p className="font-serif text-sm">
            <span className="italic">{proof.listing.title}</span>
            <span className="text-[var(--color-ink-3)]"> · {proof.listing.supplier_name} · {relativeTime(proof.usage[0].occurred_at)}</span>
          </p>
          {proof.legs.length > 0 && (
            <ul className="space-y-1">
              {proof.legs.map((l) => (
                <li key={`${l.recipient_role}-${l.recipient_wallet}`} className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[10px] uppercase tracking-[0.12em]">
                  <span className="text-[var(--color-ink-2)]">
                    {l.recipient_role} → {shortAddress(l.recipient_wallet)}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span>{fmtUsdc(l.amount_usdc)}</span>
                    {l.tx_hash ? (
                      <a
                        href={txUrl(l.tx_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-rust)] underline decoration-[var(--color-hair-strong)] underline-offset-2"
                      >
                        {shortHash(l.tx_hash)} ↗
                      </a>
                    ) : (
                      <span className="border border-[var(--color-hair-strong)] px-1.5 py-px text-[9px]">{l.status}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] px-3 py-2">
            <p className="kicker mb-1">Free with credit — rendered unmodified</p>
            <p className="font-serif text-xs leading-snug text-[var(--color-ink-2)]">{proof.listing.attribution_text}</p>
          </div>
        </div>
      )}
      {phase === "done" && (
        <p className="font-serif italic text-sm text-[var(--color-ink-2)] mt-4">
          Matched to a channel, logged with an honest reporter split, split 60/30/10 — all read from the live rails. Browse it
          yourself below.
        </p>
      )}
      {phase === "error" && error && (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-600 mt-4">
          Demo hit a snag: {error}
        </p>
      )}
    </div>
  );
}
