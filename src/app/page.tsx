"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 min-h-[100dvh]">
      <SiteHeader />
      <main className="flex-1 grid place-items-center px-6">
        <Hero />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="py-16 text-center max-w-2xl mx-auto md:py-24">
      <motion.h1
        className="font-serif text-5xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        Describe the scene.
        <br />
        <span className="italic font-normal text-[var(--color-rust)]">
          Find the track.
        </span>
      </motion.h1>
      <motion.p
        className="font-serif text-lg md:text-xl text-[var(--color-ink-2)] leading-snug mb-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        AI agents rank alternate takes to your brief in seconds.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <BriefSearchBar />
      </motion.div>
    </section>
  );
}

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
      <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        Ranked results in ~4 seconds · free · no sign-up
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-hair-strong)] px-6 py-6 flex flex-wrap items-center justify-center gap-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
        VERSIONS · 2026
      </div>
      <div className="flex gap-6 font-mono text-[10px] uppercase tracking-[0.18em]">
        <Link href="/agents" className="hover:text-[var(--color-rust)]">How it works</Link>
        <a href="https://github.com/thisyearnofear/versions" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://docs.arc.network" className="hover:text-[var(--color-rust)]" target="_blank" rel="noopener noreferrer">Arc</a>
      </div>
    </footer>
  );
}
