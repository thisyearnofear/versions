"use client";

import Link from "next/link";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { track } from "@/lib/analytics";

export function SiteHeader({ active }: { active?: "submit" | "agents" | "feed" | "discover" | "supervisor" }) {
  const tabs = [
    { id: "discover", label: "Discover", href: "/discover" },
    { id: "supervisor", label: "Dashboard", href: "/supervisor" },
    { id: "submit", label: "Submit", href: "/submit" },
  ] as const;

  return (
    <header className="border-b border-[var(--color-hair-strong)]">
      <div className="px-6 md:px-12 py-4 flex items-center justify-between gap-6">
        <Link href="/" className="font-serif text-2xl font-black tracking-tight">
          VERSIONS
        </Link>
        <div className="flex items-center gap-2">
          <nav role="tablist" className="flex overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                role="tab"
                onClick={() => track("nav_click", { to: t.href, source: "site_header" })}
                className={`font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
                  active === t.id
                    ? "border-[var(--color-rust)] text-[var(--color-rust)]"
                    : "border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <WagmiConnectButton variant="quiet" />
        </div>
      </div>
    </header>
  );
}
