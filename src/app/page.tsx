"use client";

// MODULAR: Landing page — compact, centered, kinetic. The first
// screen is a centered headline + one CTA. A full-width economy
// ticker band shows the platform is alive. A waveform gallery
// rides album covers along an SVG wave for energy. Section nav
// is compact chips with hover-reveal blurbs (progressive disclosure).

import Link from "next/link";
import { motion } from "framer-motion";
import { SiteHeader } from "@/components/SiteHeader";
import { Tour } from "@/components/ui/Tour";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { WaveformGallery } from "@/components/home/WaveformGallery";
import { track } from "@/lib/analytics";

export default function Home() {
  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <TickerBand />
        <WaveformGallery />
        <SectionNav />
      </main>
      <Footer />
      <Tour autoStart withTrigger />
    </div>
  );
}

function Hero() {
  return (
    <section className="px-6 py-20 md:py-28 text-center max-w-2xl mx-auto">
      <motion.p
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        AI-reviewed music for sync · Arc USDC · 2026
      </motion.p>
      <motion.h1
        className="font-serif text-5xl md:text-7xl font-black leading-[0.95] tracking-tight mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
      >
        Find the right
        <br />
        <span className="italic font-normal text-[var(--color-rust)]">
          version.
        </span>
      </motion.h1>
      <motion.p
        className="font-serif text-lg md:text-xl text-[var(--color-ink-2)] leading-snug mb-10"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        Three AI agents review every track. Supervisors search by brief.
        Artists get paid on Arc.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
      >
        <Link
          href="/discover"
          onClick={() => track("nav_click", { to: "/discover", source: "hero_cta" })}
          className="inline-flex items-center gap-3 bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-8 py-4 hover:bg-[var(--color-rust)] transition-colors"
        >
          Search the catalog
          <span aria-hidden="true">→</span>
        </Link>
      </motion.div>
    </section>
  );
}

function TickerBand() {
  return (
    <div className="border-t border-b border-[var(--color-hair-strong)] px-6 md:px-12 py-6">
      <EconomyTicker limit={5} />
    </div>
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
    <section className="px-6 py-12">
      <div className="max-w-3xl mx-auto">
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
                className="group relative inline-flex items-center gap-2 border border-[var(--color-hair-strong)] px-5 py-3 hover:border-[var(--color-ink)] transition-colors"
              >
                <span className="font-mono text-[9px] text-[var(--color-ink-3)]">{s.num}</span>
                <span className="font-serif text-lg font-medium">{s.label}</span>
                {/* Progressive disclosure: blurb appears on hover */}
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {s.blurb}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
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
