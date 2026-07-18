"use client";

// MODULAR: Landing page. The first thing a visitor sees. Leads
// with plain-language value prop, shows a live activity strip
// so the platform feels alive, and auto-starts the onboarding
// tour for first-time visitors. Uses the shared SiteHeader for
// consistent navigation with the other section pages.

import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Tour } from "@/components/ui/Tour";
import { LiveActivityStrip } from "@/components/home/LiveActivityStrip";
import { track } from "@/lib/analytics";

export default function Home() {
  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <LiveActivityStrip />
        <SectionNav />
      </main>
      <Footer />
      <Tour autoStart withTrigger />
    </div>
  );
}

function Hero() {
  return (
    <section className="px-6 md:px-12 py-16 md:py-24 max-w-5xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-6">
        Sync-ready music, matched by AI · 2026
      </p>
      <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight mb-6">
        Find the right
        <br />
        <span className="italic font-normal text-[var(--color-rust)]">
          version for any scene.
        </span>
      </h1>
      <p className="font-serif text-xl md:text-2xl leading-snug max-w-2xl text-[var(--color-ink-2)] mb-4">
        Paste a brief in plain English and VERSIONS ranks every
        published track by scene, instrument, emotional arc, and
        audience fit. Built for music supervisors, sync houses, and
        A&R teams who need the right sound fast.
      </p>
      <p className="font-serif text-lg leading-snug max-w-2xl text-[var(--color-ink-3)] mb-10">
        Artists submit alternate takes; AI agents review and tag them;
        supervisors search the catalog in seconds.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link
          href="/discover"
          onClick={() => track("nav_click", { to: "/discover", source: "hero_cta" })}
          className="inline-flex items-center gap-3 bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:bg-[var(--color-rust)] transition-colors"
        >
          Find music for a brief
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/feed"
          onClick={() => track("nav_click", { to: "/feed", source: "hero_cta" })}
          className="inline-flex items-center gap-3 border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
        >
          Browse the catalog
        </Link>
        <Link
          href="/submit"
          onClick={() => track("nav_click", { to: "/submit", source: "hero_cta" })}
          className="inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 text-[var(--color-ink-2)] hover:text-[var(--color-rust)] transition-colors"
        >
          Submit a version
        </Link>
      </div>
    </section>
  );
}

function SectionNav() {
  const sections = [
    {
      num: "01",
      label: "Discover",
      href: "/discover",
      blurb: "Paste a brief and rank the catalog by fit. Built for supervisors and A&R.",
    },
    {
      num: "02",
      label: "Feed",
      href: "/feed",
      blurb: "Published versions that cleared the gate. Filter by mood, energy, and tempo.",
    },
    {
      num: "03",
      label: "Submit",
      href: "/submit",
      blurb: "Upload an audio file and get rated by three AI agents in seconds.",
    },
    {
      num: "04",
      label: "Agents",
      href: "/agents",
      blurb: "Watch the AI curators review submissions in real time — no human in the loop.",
    },
  ];

  return (
    <section className="border-t border-[var(--color-hair-strong)]">
      <div className="grid md:grid-cols-2 lg:grid-cols-4">
        {sections.map((s, i) => (
          <Link
            key={s.num}
            href={s.href}
            onClick={() => track("nav_click", { to: s.href, source: "section_nav" })}
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
        VERSIONS · Alternate takes marketplace · 2026
      </div>
      <div className="flex gap-6 font-mono text-[10px] uppercase tracking-[0.18em]">
        <a href="https://github.com/thisyearnofear/versions" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Docs</a>
        <a href="https://docs.arc.network" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Arc</a>
        <a href="https://musicbrainz.org" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">MusicBrainz</a>
      </div>
    </footer>
  );
}
