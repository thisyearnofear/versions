"use client";

// MODULAR: Landing page — compact, centered, kinetic. The first
// screen is a centered headline + one CTA. A full-width economy
// ticker band shows the platform is alive. A waveform gallery
// rides album covers along an SVG wave for energy. Section nav
// is compact chips with hover-reveal blurbs (progressive disclosure).

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Tour } from "@/components/ui/Tour";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { LiveStats } from "@/components/economy/LiveStats";
import { WaveformGallery } from "@/components/home/WaveformGallery";
import { HowItWorks } from "@/components/home/HowItWorks";
import { LiveDemoButton } from "@/components/home/LiveDemoButton";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { Container, Eyebrow } from "@/components/ui/primitives";

export default function Home() {
  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <StatsBand />
        <HowItWorks />
        <TickerBand />
        <WaveformGallery />
        <DemoBand />
        <SectionNav />
      </main>
      <Footer />
      <Tour withTrigger />
    </div>
  );
}

function DemoBand() {
  return (
    <motion.section
      className="px-6 pt-10 pb-4 max-w-2xl mx-auto text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
    >
      <Eyebrow className="mb-4">For the demo · watch the agentic loop settle on Arc</Eyebrow>
      <LiveDemoButton />
    </motion.section>
  );
}

function Hero() {
  return (
    <section className="px-6 py-12 text-center max-w-2xl mx-auto md:py-20">
      <motion.p
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        Sync search · for supervisors, A&amp;R &amp; sync houses
      </motion.p>
      <motion.h1
        className="font-serif text-5xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
      >
        Describe the scene.
        <br />
        <span className="italic font-normal text-[var(--color-rust)]">
          Find the version.
        </span>
      </motion.h1>
      <motion.p
        className="font-serif text-lg md:text-xl text-[var(--color-ink-2)] leading-snug mb-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        Paste a brief in plain English. Three AI agents rank the catalog of
        alternate takes by fit — free to search, no wallet needed.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
      >
        <BriefSearchBar />
      </motion.div>
    </section>
  );
}

// Supervisor-first hero search. One field → /discover?brief=<text>, where
// DiscoverView auto-runs the inverse search. Example chips are one-click
// seeds so a cold visitor sees ranked matches with zero typing.
function BriefSearchBar() {
  const router = useRouter();
  const [brief, setBrief] = useState("");

  const submit = (t: string) => {
    const trimmed = t.trim();
    if (trimmed.length < 3) return;
    track("hero_brief_search", { len: trimmed.length });
    router.push(`/discover?brief=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="mx-auto max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(brief);
        }}
        className="flex items-stretch border border-[var(--color-ink)] bg-[var(--color-paper)]"
      >
        <input
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. tense car chase, no vocals, ~120 bpm"
          aria-label="Describe the scene you are syncing"
          className="flex-1 min-w-0 bg-transparent p-4 font-serif text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={brief.trim().length < 3}
          className="whitespace-nowrap bg-[var(--color-ink)] px-6 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors disabled:opacity-40"
        >
          Find track
        </button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Try:
        </span>
        {EXAMPLE_BRIEFS.slice(0, 4).map((e) => (
          <Link
            key={e.id}
            href={`/discover?brief=${encodeURIComponent(e.brief)}`}
            onClick={() => track("hero_brief_example", { label: e.label })}
            className="border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
          >
            {e.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        Free · no sign-up · ranked results in seconds
      </p>
    </div>
  );
}

function StatsBand() {
  return (
    <Container size="wide" className="py-4">
      <LiveStats />
    </Container>
  );
}

function TickerBand() {
  return (
    <Container size="wide" className="border-t border-b border-[var(--color-hair-strong)] py-4">
      <EconomyTicker limit={5} />
    </Container>
  );
}

function SectionNav() {
  const sections = [
    { num: "01", label: "Discover", href: "/discover", blurb: "Paste a brief. Rank the catalog." },
    { num: "02", label: "Feed", href: "/feed", blurb: "Published versions. Filter by mood." },
    { num: "03", label: "Submit", href: "/submit", blurb: "Upload. Get rated by AI agents." },
    { num: "04", label: "Agents", href: "/agents", blurb: "Watch AI review in real time." },
  ];

  return (
    <Container className="py-10">
      <div className="flex flex-wrap justify-center gap-3">
          {sections.map((s, i) => (
            <motion.div
              key={s.num}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
            >
              <Link
                href={s.href}
                onClick={() => track("nav_click", { to: s.href, source: "section_nav" })}
                className="group relative flex flex-col items-center gap-1 border border-[var(--color-hair-strong)] px-5 py-3 hover:border-[var(--color-ink)] transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-[9px] text-[var(--color-ink-3)]">{s.num}</span>
                  <span className="font-serif text-lg font-medium">{s.label}</span>
                </span>
                {/* Progressive disclosure: static under md, hover-reveal on md+ */}
                <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] md:absolute md:top-full md:left-1/2 md:-translate-x-1/2 md:mt-2 md:opacity-0 md:group-hover:opacity-100 md:transition-opacity md:pointer-events-none">
                  {s.blurb}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
    </Container>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-hair-strong)] px-6 py-6 flex flex-wrap items-center justify-center gap-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
        VERSIONS · 2026
      </div>
      <div className="flex gap-6 font-mono text-[10px] uppercase tracking-[0.18em]">
        <a href="https://github.com/thisyearnofear/versions" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://docs.arc.network" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Arc</a>
      </div>
    </footer>
  );
}
