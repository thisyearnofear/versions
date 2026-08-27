"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { track } from "@/lib/analytics";

// Primary navigation is organised around jobs, not product modules. A user
// should never ask "which tool do I use?" — only "what am I trying to get
// done?". Three doors: Search (the supervisor job), Workspace (cases,
// shortlists, licenses, and the library), Artists (supply). Public proof
// surfaces (agent activity, arc, github) are demoted out of the primary
// rail.
export type HeaderRoute = "workspace" | "brief" | "artists" | "agents";

const JOBS = [
  { id: "brief", label: "Search", href: "/discover", title: "Describe the scene — the agents rank the catalog" },
  { id: "workspace", label: "Workspace", href: "/supervisor", title: "Cases, shortlists, licenses, and the library" },
  { id: "artists", label: "For Artists", href: "/submit", title: "Hand an alternate take to your Release Agent" },
] as const;

export function SiteHeader({ active }: { active?: HeaderRoute }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Menu closes via link onClick (each nav item) and Escape. While open,
  // lock body scroll and subscribe to the Escape key.
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

        {/* Desktop rail — hidden on mobile where the menu button takes over */}
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
          <Link
            href="/agents"
            title="System proof — live agent activity across the platform"
            aria-current={active === "agents" ? "page" : undefined}
            onClick={() => track("nav_click", { to: "/agents", source: "site_header_system" })}
            className={`hidden whitespace-nowrap px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] transition-colors md:inline ${
              active === "agents"
                ? "text-[var(--color-rust)]"
                : "text-[var(--color-ink-3)] hover:text-[var(--color-rust)]"
            }`}
          >
            System · agent activity
          </Link>
          <WagmiConnectButton variant="quiet" />
        </div>

        {/* Mobile: connect + hamburger (44px touch target) */}
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
                className={`absolute bottom-0 left-0 block h-[2px] w-full bg-current transition-transform duration-200 ${menuOpen ? "-translate-y-[5px] -rotate-45" : ""}`}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile menu panel — the three doors + system proof, full-width
          rows with generous touch targets. */}
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            aria-label="Primary mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-[var(--color-hair)] bg-[var(--color-paper)] sm:hidden"
          >
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
                  <span aria-hidden="true" className="text-[var(--color-ink-3)]">→</span>
                </Link>
              ))}
              <Link
                href="/agents"
                aria-current={active === "agents" ? "page" : undefined}
                onClick={() => closeAndTrack("/agents", "site_header_mobile")}
                className="flex min-h-[48px] items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]"
              >
                System · agent activity
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
