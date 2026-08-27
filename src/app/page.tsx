"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { HowItWorks } from "@/components/home/HowItWorks";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { Reveal, EASE_OUT, Tilt } from "@/components/ui/motion";
import { WedgeDiagram } from "@/components/home/WedgeDiagram";
import { SpectrumOrb } from "@/components/home/SpectrumOrb";
import { playNoteAt, resumeAudio } from "@/lib/audio-feedback";

// PERF: below-the-fold sections are client-only dynamic chunks. They
// fetch their own data on mount anyway, so keeping them out of the
// initial HTML + main page chunk shortens the critical path for the
// hero (the actual LCP). EconomyTicker stays eager — it's in the
// first viewport.
const WaveformGallery = dynamic(
  () => import("@/components/home/WaveformGallery").then((m) => m.WaveformGallery),
  { ssr: false, loading: () => <div className="min-h-[260px] md:min-h-[340px]" aria-hidden="true" /> },
);
// One-button live demo (submit → pay on Arc → agent review → publish → tip).
// Client-only: it builds wallets in the browser and drives public APIs.
const LiveDemoButton = dynamic(
  () => import("@/components/home/LiveDemoButton").then((m) => m.LiveDemoButton),
  { ssr: false, loading: () => <div className="min-h-[120px]" aria-hidden="true" /> },
);

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="px-4 sm:px-6">
          <Hero />
        </div>

        {/* The wedge, illustrated: brief → agents → match → settlement.
            One diagram replaces what used to be paragraphs of mechanism. */}
        <section className="px-4 pb-4 sm:px-6" aria-label="How a brief becomes a license">
          <Reveal>
            <WedgeDiagram />
          </Reveal>
        </section>

        {/* Compact proof band: the pitch and the live system side by side. */}
        <section
          className="border-y border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-4 py-10 sm:px-6 md:py-14"
          aria-labelledby="placement-case-title"
        >
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
            <Reveal>
              <p className="kicker kicker--accent mb-3">One case, one decision</p>
              <h2
                id="placement-case-title"
                className="font-serif text-2xl font-black tracking-tight sm:text-3xl md:text-4xl"
              >
                Held open. Waiting for your call.
              </h2>
              <p className="mt-3 max-w-md font-serif text-base leading-snug text-[var(--color-ink-2)]">
                The case stays open until you make the creative call —
                everything else settles on-chain.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/discover" className="btn-primary">
                  Start a brief →
                </Link>
                <Link
                  href="/discover?brief=dark%20ambient%20cinematic&showcase=pilot"
                  className="btn-secondary"
                >
                  Watch the authorized pilot →
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <Tilt max={6} className="h-full">
                <div className="card-surface h-full p-5 sm:p-6">
                  <p className="kicker mb-4">Live · system proof</p>
                  <LiveDemoButton />
                  <div className="mt-5 border-t border-[var(--color-hair)] pt-5">
                    <EconomyTicker limit={6} />
                  </div>
                </div>
              </Tilt>
            </Reveal>
          </div>
        </section>

        <section aria-label="Recent work published by the agents">
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

/* ── Hero ─────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative mx-auto max-w-2xl overflow-visible py-10 text-center sm:py-14 md:py-20">
      {/* The orb sits behind the headline as the hero's energy source.
          Mouse-reactive spectrum — visitors play it as they read. */}
      <div className="pointer-events-none absolute left-1/2 top-6 -z-10 h-[360px] w-[360px] -translate-x-1/2 sm:h-[440px] sm:w-[440px] md:h-[520px] md:w-[520px]">
        <SpectrumOrb className="pointer-events-auto h-full w-full opacity-90" />
      </div>
      <AmbientBars />
      <motion.p
        className="kicker kicker--accent relative mb-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        For music supervisors &amp; sync agents
      </motion.p>
      <motion.h1
        className="relative mb-4 font-serif text-4xl font-black leading-[0.98] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <span className="text-gradient">Finding the right take</span>
        <br />
        <span className="relative inline-block font-normal italic text-[var(--color-rust)]">
          shouldn&apos;t take weeks.
          <UnderlineDraw />
        </span>
      </motion.h1>
      <motion.p
        className="relative mx-auto mb-7 max-w-xl font-serif text-base leading-snug text-[var(--color-ink-2)] sm:text-lg md:text-xl"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: EASE_OUT }}
      >
        Describe the scene — the agents rank artist-authorized versions by
        fit and prepare the rights path. You make one call.
      </motion.p>
      <motion.div
        className="relative"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: EASE_OUT }}
      >
        <BriefSearchBar />
      </motion.div>
    </section>
  );
}

/** Hand-drawn underline that sketches itself under the hero punchline. */
function UnderlineDraw() {
  const reduce = useReducedMotion();
  return (
    <svg
      viewBox="0 0 300 14"
      aria-hidden="true"
      className="absolute -bottom-2 left-0 h-3 w-full"
      preserveAspectRatio="none"
    >
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

/** Ambient equaliser bars drifting behind the hero — the catalog, felt
    rather than listed. Deterministic heights, zero layout cost. */
const BAR_HEIGHTS = [26, 44, 62, 38, 70, 30, 52, 66, 34, 48, 58, 28, 64, 40, 54, 32, 68, 36, 50, 60, 26, 46, 56, 42];

function AmbientBars() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 -bottom-2 flex h-[76px] items-end justify-between gap-1 opacity-70"
    >
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

  const submit = (t: string) => {
    const trimmed = t.trim();
    if (trimmed.length < 3) return;
    track("hero_brief_search", { len: trimmed.length });
    router.push(`/discover?brief=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="mx-auto max-w-xl">
      {/* Elevated search: rounded, soft shadow, lifts on focus-within.
          Stacks on mobile so the CTA keeps a 44px touch target. */}
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
          placeholder="e.g. tense car chase, no vocals, ~120 bpm"
          aria-label="Describe the scene you are syncing"
          enterKeyHint="search"
          className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] bg-transparent px-4 py-3 font-serif text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={brief.trim().length < 3}
          className="btn-primary w-full sm:w-auto"
        >
          Start a brief
        </button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="kicker">Try:</span>
        {EXAMPLE_BRIEFS.slice(0, 4).map((e, idx) => (
          <Link
            key={e.id}
            href={`/discover?brief=${encodeURIComponent(e.brief)}`}
            onClick={() => track("hero_brief_example", { label: e.label })}
            onMouseEnter={() => {
              resumeAudio();
              // Musical interaction: each chip sings a different note
              // down the scale as you browse — the search itself has a melody.
              playNoteAt(1 - (idx / Math.max(1, EXAMPLE_BRIEFS.slice(0, 4).length - 1)));
            }}
            className="chip"
          >
            {e.label}
          </Link>
        ))}
      </div>
      <p className="kicker mt-4">Free to search · no sign-up · move your cursor over the spectrum →</p>
    </div>
  );
}
