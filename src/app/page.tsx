"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { track } from "@/lib/analytics";
import { HowItWorks } from "@/components/home/HowItWorks";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { LiveStats } from "@/components/economy/LiveStats";
import { Reveal, EASE_OUT, Tilt } from "@/components/ui/motion";
import { WedgeDiagram } from "@/components/home/WedgeDiagram";
import { SpectrumOrb } from "@/components/home/SpectrumOrb";
import { playNoteAt, resumeAudio } from "@/lib/audio-feedback";
import { AGREEMENT_VERSION } from "@/lib/agreement";

const WaveformGallery = dynamic(
  () => import("@/components/home/WaveformGallery").then((m) => m.WaveformGallery),
  { ssr: false, loading: () => <div className="min-h-[260px] md:min-h-[340px]" aria-hidden="true" /> },
);
const LiveDemoButton = dynamic(
  () => import("@/components/home/LiveDemoButton").then((m) => m.LiveDemoButton),
  { ssr: false, loading: () => <div className="min-h-[120px]" aria-hidden="true" /> },
);

const SUPPLY_EXAMPLES: Array<{ label: string; brief: string }> = [
  { label: "lo-fi night drive", brief: "lo-fi night drive, warm, instrumental" },
  { label: "cold brew ad", brief: "bright morning routine, coffee, upbeat" },
  { label: "thriller tension", brief: "tense car chase, no vocals, ~120 bpm" },
  { label: "cozy study stream", brief: "cozy study beats, soft, low energy" },
];

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="px-4 sm:px-6">
          <Hero />
        </div>

        <section className="px-4 pb-4 sm:px-6" aria-label="How supply finds its channel">
          <Reveal>
            <WedgeDiagram />
          </Reveal>
        </section>

        <section
          className="border-y border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-4 py-10 sm:px-6 md:py-14"
          aria-labelledby="marketplace-proof-title"
        >
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
            <Reveal>
              <p className="kicker kicker--accent mb-3">Music + product placements</p>
              <h2 id="marketplace-proof-title" className="font-serif text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
                Free with credit. Paid when it pays.
              </h2>
              <p className="mt-3 max-w-md font-serif text-base leading-snug text-[var(--color-ink-2)]">
                Same primitive, two catalogs. Free use under the blanket agreement carries a generated attribution you render
                unmodified; paid placements are flat-fee or CPM with a tracking code, disclosure, and budget cap — self-serve.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/discover" className="btn-primary" onClick={() => track("cta_browse", { from: "landing" })}>
                  Browse supply →
                </Link>
                <Link href="/submit" className="btn-secondary" onClick={() => track("cta_supply", { from: "landing" })}>
                  List a track or product →
                </Link>
                <Link
                  href="/channels"
                  className="btn-secondary"
                  onClick={() => track("cta_channels", { from: "landing" })}
                >
                  Connect a channel →
                </Link>
              </div>
              <p className="kicker mt-4">
                Agreement {AGREEMENT_VERSION} · settled in USDC on Arc · <Link href="/legal/agreement" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">read the terms</Link>
              </p>
              <p className="kicker mt-2">
                Paid slots unlock on platform-verified reach only · every logged use says who reported it — channel or platform
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <Tilt max={6} className="h-full">
                <div className="card-surface h-full p-5 sm:p-6">
                  <p className="kicker mb-4">Live · system proof</p>
                  <LiveDemoButton />
                  <div className="mt-5 border-t border-[var(--color-hair)] pt-5">
                    <EconomyTicker limit={6} title="Placements & settlements" />
                  </div>
                </div>
              </Tilt>
            </Reveal>
          </div>
          <Reveal delay={0.15}>
            <div className="mx-auto mt-8 max-w-5xl border-t border-[var(--color-hair)] pt-6">
              <p className="kicker mb-1 text-center">Counted from the rails</p>
              <LiveStats />
            </div>
          </Reveal>
        </section>

        <section aria-label="Supply on VERSIONS">
          <div className="px-6 pb-2 pt-8 text-center">
            <p className="kicker">From the catalog · click to listen</p>
          </div>
          <WaveformGallery />
        </section>
        <HowItWorks />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto max-w-2xl overflow-visible py-10 text-center sm:py-14 md:py-20">
      <div className="pointer-events-none absolute left-1/2 top-6 -z-10 h-[360px] w-[360px] -translate-x-1/2 sm:h-[440px] sm:w-[440px] md:h-[520px] md:w-[520px]">
        <SpectrumOrb className="pointer-events-auto h-full w-full opacity-90" />
      </div>
      <AmbientBars />
      <motion.p className="kicker kicker--accent relative mb-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        Ad infra for AI-run distribution · music &amp; product placements
      </motion.p>
      <motion.h1
        className="relative mb-4 font-serif text-4xl font-black leading-[0.98] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <span className="text-gradient">Supply that fits</span>
        <br />
        <span className="relative inline-block font-normal italic text-[var(--color-rust)]">
          your channel&apos;s ethos.
          <UnderlineDraw />
        </span>
      </motion.h1>
      <motion.p
        className="relative mx-auto mb-7 max-w-xl font-serif text-base leading-snug text-[var(--color-ink-2)] sm:text-lg md:text-xl"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: EASE_OUT }}
      >
        Channels browse a feed of tracks and products, pick what fits, and use it — free with attribution or paid as a
        sponsor slot. Built for the AI distribution wave — YouTube automation, radio-style feeds — we match, track, and
        settle: <span className="whitespace-nowrap">60/30/10 supplier / channel / platform</span>, in USDC on Arc
        <span className="text-[var(--color-ink-3)]"> (Circle&apos;s chain)</span>.
      </motion.p>
      <motion.div className="relative" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2, ease: EASE_OUT }}>
        <BriefSearchBar />
      </motion.div>
    </section>
  );
}

function UnderlineDraw() {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 300 14" aria-hidden="true" className="absolute -bottom-2 left-0 h-3 w-full" preserveAspectRatio="none">
      <motion.path
        d="M4 10 C 70 3, 180 13, 296 5"
        fill="none"
        stroke="var(--color-rust)"
        strokeWidth="3"
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ delay: 0.7, duration: 0.7, ease: "easeOut" }}
      />
    </svg>
  );
}

const BAR_HEIGHTS = [26, 44, 62, 38, 70, 30, 52, 66, 34, 48, 58, 28, 64, 40, 54, 32, 68, 36, 50, 60, 26, 46, 56, 42];

function AmbientBars() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-2 flex h-[76px] items-end justify-between gap-1 opacity-70">
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="eq-bar w-[3px] rounded-full"
          style={{
            height: h,
            backgroundColor: i % 6 === 0 ? "rgba(200,74,31,0.14)" : "rgba(26,26,26,0.06)",
            animationDelay: `${(i % 8) * 0.28}s`,
            animationDuration: `${3.4 + (i % 5) * 0.4}s`,
          }}
        />
      ))}
    </div>
  );
}

function BriefSearchBar() {
  const router = useRouter();
  const [brief, setBrief] = useState("");

  // MODULAR: hero search routes to the marketplace browse (?q=), not the
  // legacy supervisor brief search (?brief=). Music + placements rank by
  // channel-ethos semantic / tag match on /discover; ?brief= stays the
  // supervisor deep-link for the brief-search rail lower on that page.
  const submit = (t: string) => {
    const trimmed = t.trim();
    if (trimmed.length < 2) return;
    track("hero_brief_search", { len: trimmed.length });
    router.push(`/discover?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="mx-auto max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(brief);
        }}
        className="card-surface flex flex-col gap-2 p-2 transition-shadow focus-within:shadow-[var(--shadow-lift)] sm:flex-row sm:items-stretch sm:gap-0 sm:p-1.5"
      >
        <input
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. lo-fi night drive, or coffee for a morning routine…"
          aria-label="Describe the vibe your channel needs"
          enterKeyHint="search"
          className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] bg-transparent px-4 py-3 font-serif text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none"
        />
        <button type="submit" disabled={brief.trim().length < 2} className="btn-primary w-full sm:w-auto">
          Browse
        </button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="kicker">Try:</span>
        {SUPPLY_EXAMPLES.slice(0, 4).map((e, idx) => (
          <Link
            key={e.label}
            href={`/discover?q=${encodeURIComponent(e.brief)}`}
            onClick={() => track("hero_brief_example", { label: e.label })}
            onMouseEnter={() => {
              resumeAudio();
              playNoteAt(1 - idx / Math.max(1, SUPPLY_EXAMPLES.length - 1));
            }}
            className="chip"
          >
            {e.label}
          </Link>
        ))}
      </div>
      <p className="kicker mt-4">
        Free to browse · no sign-up
        <span className="hover-hint"> · move your cursor over the spectrum →</span>
      </p>
    </div>
  );
}
