"use client";

// MODULAR: Persistent site header with the 4-tab navigation.
// The right-hand area shows the RainbowKit ConnectButton (which
// includes the address chip once connected).

import Link from "next/link";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { track } from "@/lib/analytics";

export function SiteHeader({ active }: { active?: "submit" | "agents" | "feed" | "discover" }) {
  const tabs = [
    { id: "submit", label: "Submit", href: "/submit" },
    { id: "agents", label: "Agents", href: "/agents" },
    { id: "feed", label: "Feed", href: "/feed" },
    { id: "discover", label: "Discover", href: "/discover" },
  ] as const;

  return (
    <header className="border-b border-[var(--color-hair-strong)]">
      <div className="px-6 md:px-12 py-5 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-baseline gap-4">
          <div className="font-serif text-2xl font-black tracking-tight">VERSIONS</div>
          <div className="hidden md:block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            A marketplace for alternate takes
          </div>
        </Link>
        <WagmiConnectButton variant="default" />
      </div>
      <nav role="tablist" className="px-6 md:px-12 flex overflow-x-auto border-t border-[var(--color-hair)]">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            onClick={() => track("nav_click", { to: t.href, source: "site_header" })}
            className={`font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-4 border-b-2 transition-colors whitespace-nowrap ${
              active === t.id
                ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                : "border-transparent hover:border-[var(--color-ink)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
