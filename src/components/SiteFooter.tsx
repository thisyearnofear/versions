import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-hair-strong)] px-4 py-6 sm:px-6 md:px-12">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
          VERSIONS · 2026
        </div>
        <nav className="flex flex-wrap flex-col items-start sm:flex-row sm:items-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em]" aria-label="Footer">
          <Link href="/discover" className="hover:text-[var(--color-rust)]">Search</Link>
          <Link href="/supervisor" className="hover:text-[var(--color-rust)]">Workspace</Link>
          <Link href="/submit" className="hover:text-[var(--color-rust)]">For Artists</Link>
          <span className="text-[var(--color-ink-3)]">·</span>
          <Link href="/agents" className="hover:text-[var(--color-rust)]">Agent activity</Link>
          <a href="https://docs.arc.network" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Arc</a>
          <a href="https://github.com/thisyearnofear/versions" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
