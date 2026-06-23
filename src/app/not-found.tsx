import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-24 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-6">
        VERSIONS · 404
      </p>
      <h1 className="font-serif text-6xl md:text-8xl font-black tracking-tight mb-6">
        That cut doesn&apos;t exist.
      </h1>
      <p className="font-serif text-lg text-[var(--color-ink-2)] max-w-md mb-12">
        The version you&apos;re looking for was never submitted, or it was pulled
        from the catalog.
      </p>
      <Link
        href="/"
        className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:bg-[var(--color-rust)] transition-colors"
      >
        Back to feed →
      </Link>
    </div>
  );
}
