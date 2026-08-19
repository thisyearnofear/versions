"use client";

import Link from "next/link";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";
import { track } from "@/lib/analytics";

// Primary navigation is organised around jobs, not product modules. A user
// should never ask "which tool do I use?" — only "what am I trying to get
// done?". Three doors: Search (the supervisor job), Workspace (cases,
// shortlists, licenses, and the library), Artists (supply). Public proof
// surfaces (agent activity, arc, github) are demoted out of the primary
// rail.
export type HeaderRoute = "workspace" | "brief" | "artists" | "agents";

export function SiteHeader({ active }: { active?: HeaderRoute }) {
  const jobs = [
    { id: "brief", label: "Search", href: "/discover", title: "Describe the scene — the agents rank the catalog" },
    { id: "workspace", label: "Workspace", href: "/supervisor", title: "Cases, shortlists, licenses, and the library" },
    { id: "artists", label: "For Artists", href: "/submit", title: "Hand an alternate take to your Release Agent" },
  ] as const;

  return (
    <header className="border-b border-[var(--color-hair-strong)]">
      <div className="px-6 md:px-12 py-4 flex items-center justify-between gap-6">
        <Link href="/" className="font-serif text-2xl font-black tracking-tight">
          VERSIONS
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <nav aria-label="Primary" className="min-w-0 flex-1 overflow-x-auto">
            {jobs.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                title={t.title}
                onClick={() => track("nav_click", { to: t.href, source: "site_header" })}
                aria-current={active === t.id ? "page" : undefined}
                className={`font-mono text-[12px] uppercase tracking-[0.18em] px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
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
            className={`hidden sm:inline font-mono text-[9px] uppercase tracking-[0.16em] px-3 py-2 transition-colors whitespace-nowrap ${
              active === "agents"
                ? "text-[var(--color-rust)]"
                : "text-[var(--color-ink-3)] hover:text-[var(--color-rust)]"
            }`}
          >
            System · agent activity
          </Link>
          <WagmiConnectButton variant="quiet" />
        </div>
      </div>
    </header>
  );
}
