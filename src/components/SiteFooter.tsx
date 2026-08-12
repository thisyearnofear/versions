import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-hair-strong)] px-6 py-6 md:px-12">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
          VERSIONS · 2026
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em]" aria-label="Footer">
          <Link href="/discover" className="hover:text-[var(--color-rust)]">Discover</Link>
          <Link href="/agents" className="hover:text-[var(--color-rust)]">Agents</Link>
          <Link href="/feed" className="hover:text-[var(--color-rust)]">Catalog</Link>
          <a href="https://github.com/thisyearnofear/versions" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://docs.arc.network" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Arc</a>
        </nav>
      </div>
    </footer>
  );
}
