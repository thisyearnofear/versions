"use client";

// MODULAR: the machine-economy payout split. Every settled submission
// fans USDC out to curator agents, the platform, and MusicBrainz — this
// bar makes that autonomous distribution legible at a glance rather than
// as a single opaque "USDC settled" counter. Renders nothing until real
// settled legs exist, so the empty landing page looks identical to today.

import { motion } from "framer-motion";
import { fmtUsdc } from "@/lib/format";

export interface SplitLeg {
  role: string;
  totalUsdc: string;
  legCount: number;
}

const ROLE_COLOR: Record<string, string> = {
  curator: "var(--color-rust)",
  platform: "var(--color-ink)",
  musicbrainz: "var(--color-ink-3)",
};

const ROLE_LABEL: Record<string, string> = {
  curator: "Curators",
  platform: "Platform",
  musicbrainz: "MusicBrainz",
};

export function SettlementSplitBar({ split }: { split: SplitLeg[] }) {
  const rows = split
    .map((r) => ({ ...r, amount: Number(r.totalUsdc) }))
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0);

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  if (rows.length === 0 || total <= 0) return null;

  return (
    <div className="max-w-md mx-auto mt-4">
      <div className="flex gap-px h-1.5 overflow-hidden">
        {rows.map((r) => (
          <motion.div
            key={r.role}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="origin-left"
            style={{
              flexGrow: r.amount,
              minWidth: "3%",
              background: ROLE_COLOR[r.role] ?? "var(--color-ink-2)",
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        {rows.map((r) => (
          <span key={r.role} className="whitespace-nowrap">
            <span
              aria-hidden="true"
              className="inline-block w-1.5 h-1.5 mr-1 align-middle"
              style={{ background: ROLE_COLOR[r.role] ?? "var(--color-ink-2)" }}
            />
            {ROLE_LABEL[r.role] ?? r.role} ${fmtUsdc(r.amount)}
          </span>
        ))}
      </div>
    </div>
  );
}
