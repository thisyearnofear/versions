// MODULAR: Inline wallet glossary. First-time users coming from the
// landing page may not know what a wallet is, why they need one, or
// what "0x…" means. This component renders a compact explainer
// alongside the connect button — collapsed by default to keep the
// header breathable, expanded on click for the full caption.
//
// DRY: every page that includes the connect button can render this
//      component once; the prose is the same everywhere.

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface WalletGlossaryProps {
  // Optional override for the "what is" title.
  variant?: "compact" | "expanded";
}

const TERMS: Array<{ term: string; def: React.ReactNode }> = [
  {
    term: "Wallet",
    def: (
      <>
        A small app on your phone or browser that holds your wallet
        address and signs messages. Think of it as your{" "}
        <em>login + signature</em> for the decentralized web.
      </>
    ),
  },
  {
    term: "Address",
    def: (
      <>
        A 0x… string that identifies your wallet on Arc, Base, Ethereum,
        and other EVM chains. Public — share it freely; never share its
        seed phrase or private key.
      </>
    ),
  },
  {
    term: "USDC",
    def: (
      <>
        A stablecoin pegged to the US dollar, used for settlement on
        Arc. 1 USDC ≈ $1.
      </>
    ),
  },
  {
    term: "Chain",
    def: (
      <>
        The network your wallet is connected to. VERSIONS supports
        Arc testnet, Base, and Ethereum mainnet; the Connect button
        lets you switch.
      </>
    ),
  },
];

export function WalletGlossary({ variant = "compact" }: WalletGlossaryProps) {
  const [open, setOpen] = useState(false);
  const isCompact = variant === "compact";

  return (
    <div
      className={cn(
        "border border-[var(--color-hair)] bg-[var(--color-paper-2)]/40",
        isCompact ? "mt-2" : "mt-4",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-paper-2)]/70 transition-colors"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
          {open ? "Hide" : "What is a"} wallet?
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "font-mono text-[11px] text-[var(--color-ink-3)] transition-transform",
            open && "rotate-90",
          )}
        >
          →
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-hair)] px-4 py-3 font-serif text-sm text-[var(--color-ink-2)] leading-snug">
          <p className="mb-3">
            A <strong className="text-[var(--color-ink)] font-medium">wallet</strong> is your
            identity on VERSIONS. It signs the messages that prove a
            submission came from you, that a rating came from a real
            curator, and that a payment settled from this account. No
            email, no password.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {TERMS.map((t) => (
              <div key={t.term}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-0.5">
                  {t.term}
                </dt>
                <dd className="font-serif text-[13px] leading-snug">{t.def}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            Don&apos;t have a wallet? MetaMask and Coinbase Wallet work
            out of the box — the connect button lists every option.
          </p>
        </div>
      )}
    </div>
  );
}
