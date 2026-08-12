"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { HowItWorks } from "@/components/home/HowItWorks";
import { LiveActivityStrip } from "@/components/home/LiveActivityStrip";
import { LiveDemoButton } from "@/components/home/LiveDemoButton";
import { WaveformGallery } from "@/components/home/WaveformGallery";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { LiveStats } from "@/components/economy/LiveStats";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 min-h-[100dvh]">
      <SiteHeader />
      <main className="flex-1">
        <div className="px-6">
          <Hero />
        </div>

        <section className="border-b border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-6 py-14 md:py-20" aria-labelledby="engine-room-title">
          <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="text-center lg:text-left">
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-rust)]">
                The engine room
              </p>
              <h2 id="engine-room-title" className="font-serif text-3xl font-black tracking-tight md:text-5xl">
                One click. Five state changes.
              </h2>
              <p className="mx-auto mt-3 max-w-xl font-serif text-base leading-snug text-[var(--color-ink-2)] lg:mx-0">
                Create a demo submission, let three agents reach consensus, publish it, and settle the tip — live, in front of you.
              </p>
              <div className="mt-8">
                <LiveDemoButton />
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                  Mock settlement by default · Arc-ready when configured
                </p>
              </div>
              <div className="mt-8 border-t border-[var(--color-hair-strong)] pt-6">
                <LiveStats />
              </div>
            </div>
            <div className="border-t border-[var(--color-hair-strong)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <EconomyTicker limit={6} />
            </div>
          </div>
        </section>

        <section aria-label="The VERSIONS catalog">
          <div className="px-6 pt-12 pb-4 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
              The catalog · click the waveform to play
            </p>
          </div>
          <WaveformGallery />
        </section>

        <LiveActivityStrip />
        <HowItWorks />
      </main>
      <SiteFooter />
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
