"use client";

import Link from "next/link";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";

export default function Home() {
  return (
    <div className="flex flex-col flex-1">
      <Header />
      <main className="flex-1">
        <Hero />
        <SectionNav />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-[var(--color-hair-strong)] px-6 md:px-12 py-5 flex items-center justify-between gap-6">
      <div className="flex items-baseline gap-4">
        <div className="font-serif text-2xl font-black tracking-tight">
          VERSIONS
        </div>
        <div className="hidden md:block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          A marketplace for alternate takes
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/submit"
          className="font-mono text-[11px] uppercase tracking-[0.18em] hover:text-[var(--color-rust)] transition-colors"
        >
          Submit
        </Link>
        <Link
          href="/feed"
          className="font-mono text-[11px] uppercase tracking-[0.18em] hover:text-[var(--color-rust)] transition-colors"
        >
          Feed
        </Link>
        <WagmiConnectButton variant="compact" />
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 md:px-12 py-16 md:py-28 max-w-5xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-8">
        Lepton Submission Marketplace · est. 2026
      </p>
      <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight mb-8">
        A demo, a live take,
        <br />
        <span className="italic font-normal text-[var(--color-rust)]">
          the cut almost buried.
        </span>
      </h1>
      <p className="font-serif text-xl md:text-2xl leading-snug max-w-2xl text-[var(--color-ink-2)] mb-12">
        Submit a version. Three AI agent curators analyze Production,
        Performance, and Market in seconds. The 0.50 USDC submission fee
        settles instantly on Arc — 70/20/10 split between curators, platform,
        and MusicBrainz attribution.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link
          href="/submit"
          className="inline-flex items-center gap-3 bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:bg-[var(--color-rust)] transition-colors"
        >
          Submit a version
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/discover"
          className="inline-flex items-center gap-3 border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
        >
          Discover playlists
        </Link>
      </div>
    </section>
  );
}

function SectionNav() {
  const sections = [
    {
      num: "01",
      label: "Submit",
      href: "/submit",
      blurb: "Upload an audio file, fill in the metadata, pay 0.50 USDC. The submission fee funds the curator pool.",
    },
    {
      num: "02",
      label: "Agents",
      href: "/agents",
      blurb: "Three autonomous AI agents review every submission — no human in the loop. See what they decided in real time.",
    },
    {
      num: "03",
      label: "Feed",
      href: "/feed",
      blurb: "Versions that cleared the publish gate — at least three curator ratings. Filter by mood, energy, tempo.",
    },
    {
      num: "04",
      label: "Discover",
      href: "/discover",
      blurb: "A&R agent curated playlists from the published catalog. Each play pays the artist $0.0005 USDC.",
    },
  ];

  return (
    <section className="border-t border-[var(--color-hair-strong)]">
      <div className="grid md:grid-cols-2 lg:grid-cols-4">
        {sections.map((s, i) => (
          <Link
            key={s.num}
            href={s.href}
            className={`group p-8 md:p-10 hover:bg-[var(--color-paper-2)] transition-colors ${
              i < sections.length - 1
                ? "md:border-r border-b md:border-b-0 border-[var(--color-hair)]"
                : ""
            }`}
          >
            <div className="flex items-baseline justify-between mb-6">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
                Section {s.num}
              </span>
              <span
                className="font-mono text-xl text-[var(--color-ink-3)] group-hover:text-[var(--color-rust)] group-hover:translate-x-1 transition-all"
                aria-hidden="true"
              >
                →
              </span>
            </div>
            <h3 className="font-serif text-3xl font-black mb-3">{s.label}</h3>
            <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug">
              {s.blurb}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-hair-strong)] px-6 md:px-12 py-8 flex flex-wrap items-center justify-between gap-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
        VERSIONS · Lepton Submission Marketplace · 2026
      </div>
      <div className="flex gap-6 font-mono text-[10px] uppercase tracking-[0.18em]">
        <a href="https://github.com/thisyearnofear/versions" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Docs</a>
        <a href="https://docs.arc.network" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Arc</a>
        <a href="https://musicbrainz.org" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">MusicBrainz</a>
      </div>
    </footer>
  );
}
