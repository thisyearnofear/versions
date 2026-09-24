"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { track } from "@/lib/analytics";

// Three doors only — Browse, Supply, Channels. Everything else is gone.
export type HeaderRoute = "browse" | "supply" | "channels";

const JOBS = [
  { id: "browse", label: "Browse", href: "/discover", title: "Music & placements matched to your channel's ethos" },
  { id: "supply", label: "Supply", href: "/submit", title: "List a track or a product — live immediately under the blanket agreement" },
  { id: "channels", label: "Channels", href: "/channels", title: "Connect a distribution surface — verified reach unlocks paid placements" },
] as const;

export function SiteHeader({ active }: { active?: HeaderRoute }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeAndTrack = (href: string, source: string) => {
    setMenuOpen(false);
    track("nav_click", { to: href, source });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-hair-strong)] bg-[var(--color-paper)]/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4 md:px-12">
        <Link href="/" className="shrink-0 font-serif text-xl sm:text-2xl font-black tracking-tight">
          VERSIONS
        </Link>

        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <nav aria-label="Primary" className="min-w-0 flex-1 overflow-x-auto">
            {JOBS.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                title={t.title}
                onClick={() => track("nav_click", { to: t.href, source: "site_header" })}
                aria-current={active === t.id ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2 font-mono text-[12px] uppercase tracking-[0.18em] transition-colors ${
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

        <div className="flex items-center gap-1 sm:hidden">
          <WagmiConnectButton variant="quiet" />
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-rust-soft)]"
          >
            <span className="relative block h-3 w-5" aria-hidden="true">
              <span
                className={`absolute left-0 top-0 block h-[2px] w-full bg-current transition-transform duration-200 ${menuOpen ? "translate-y-[5px] rotate-45" : ""}`}
              />
              <span
                className={`absolute left-0 top-[5px] block h-[2px] w-full bg-current transition-opacity duration-200 ${menuOpen ? "opacity-0" : ""}`}
              />
              <span
                className={`absolute left-0 top-[10px] block h-[2px] w-full bg-current transition-transform duration-200 ${menuOpen ? "-translate-y-[5px] -rotate-45" : ""}`}
              />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav aria-label="Primary mobile" className="border-t border-[var(--color-hair)] bg-[var(--color-paper)] sm:hidden">
          <div className="flex flex-col px-4 py-3">
            {JOBS.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={active === t.id ? "page" : undefined}
                onClick={() => closeAndTrack(t.href, "site_header_mobile")}
                className={`flex min-h-[48px] items-center justify-between border-b border-[var(--color-hair)] font-mono text-[13px] uppercase tracking-[0.18em] ${
                  active === t.id ? "text-[var(--color-rust)]" : "text-[var(--color-ink)]"
                }`}
              >
                {t.label}
                <span aria-hidden="true" className="text-[var(--color-ink-3)]">
                  →
                </span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
