"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { track } from "@/lib/analytics";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { HowItWorks } from "@/components/home/HowItWorks";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { SceneCard, type SceneCardBrief } from "@/components/discovery/SceneCard";

// PERF: below-the-fold sections are client-only dynamic chunks. They
// fetch their own data on mount anyway, so keeping them out of the
// initial HTML + main page chunk shortens the critical path for the
// hero (the actual LCP). EconomyTicker stays eager — it's in the
// first viewport.
const WaveformGallery = dynamic(
  () => import("@/components/home/WaveformGallery").then((m) => m.WaveformGallery),
  { ssr: false, loading: () => <div className="min-h-[340px] md:min-h-[420px]" aria-hidden="true" /> },
);
const LiveActivityStrip = dynamic(
  () => import("@/components/home/LiveActivityStrip").then((m) => m.LiveActivityStrip),
  { ssr: false, loading: () => <div className="min-h-[220px]" aria-hidden="true" /> },
);

const HOME_SCENE_BRIEF: SceneCardBrief = {
  scene_tags: ["neon city", "night drive", "forward motion"],
  instruments: ["synth", "sub bass", "drums"],
  emotional_arcs: ["tense", "driving", "release"],
  audience_summary: "A restrained electronic bed that leaves room for dialogue, then opens into a clean payoff.",
};

export default function Home() {
  return (
    <div className="flex flex-col flex-1 min-h-[100dvh]">
      <SiteHeader />
      <main className="flex-1">
        <div className="px-6">
          <Hero />
        </div>

        <section className="border-b border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-6 py-14 md:py-20" aria-labelledby="placement-case-title">
          <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
            <div>
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-rust)]">
                A placement case · open, owned by an agent
              </p>
              <h2 id="placement-case-title" className="font-serif text-3xl font-black tracking-tight md:text-4xl">
                Owned by an agent. Held open for one human decision.
              </h2>
              <div className="mt-6 border border-[var(--color-hair-strong)] bg-[var(--color-paper)] p-5 font-mono text-xs">
                <div className="mb-3 border-b border-[var(--color-hair)] pb-3 text-[var(--color-ink-2)]">
                  Night drive · restrained electronic · 30 sec · no vocals
                </div>
                <ul className="flex flex-col gap-2 text-[var(--color-ink-2)]">
                  <li className="flex gap-2">
                    <span className="text-[var(--color-rust)]" aria-hidden="true">✓</span> Interpreted the brief
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[var(--color-rust)]" aria-hidden="true">✓</span> Ranked 42 eligible takes
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[var(--color-rust)]" aria-hidden="true">✓</span> Prepared 3 evidence-backed recommendations
                  </li>
                  <li className="flex gap-2 font-medium text-[var(--color-ink)]" aria-hidden="true">
                    <span>!</span> Needs your judgment — choose a creative direction
                  </li>
                  <li className="flex gap-2 text-[var(--color-ink-3)]">
                    <span aria-hidden="true">○</span> Rights review begins once you shortlist
                  </li>
                </ul>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/discover"
                  className="bg-[var(--color-ink)] font-mono text-[10px] uppercase tracking-[0.16em] px-5 py-3 text-[var(--color-paper)] hover:bg-[var(--color-rust)] transition-colors"
                >
                  Start a brief →
                </Link>
                <Link
                  href="/supervisor"
                  className="border border-[var(--color-ink)] font-mono text-[10px] uppercase tracking-[0.16em] px-5 py-3 text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-colors"
                >
                  Open your workspace
                </Link>
              </div>
            </div>
            <div className="border-t border-[var(--color-hair-strong)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                Live · system proof
              </p>
              <EconomyTicker limit={6} />
            </div>
          </div>
        </section>

        <section className="border-b border-[var(--color-hair-strong)] px-6 py-14 md:py-20" aria-labelledby="scene-preview-title">
          <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-rust)]">
                New · visual brief preview
              </p>
              <h2 id="scene-preview-title" className="font-serif text-3xl font-black tracking-tight md:text-4xl">
                See the scene before you choose the take.
              </h2>
              <p className="mt-4 max-w-xl font-serif text-base leading-snug text-[var(--color-ink-2)]">
                Describe the picture in plain language. The brief becomes a quick storyboard, so you can judge whether the music is moving in the right direction before opening a full take.
              </p>
              <Link
                href="/discover?brief=Tense%20neon-lit%20car%20chase%20at%20night%2C%20electronic%2C%20no%20vocals"
                className="mt-6 inline-flex bg-[var(--color-ink)] px-5 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-paper)] transition-colors hover:bg-[var(--color-rust)]"
              >
                Try the visual brief →
              </Link>
            </div>
            <SceneCard
              brief={HOME_SCENE_BRIEF}
              briefText="Tense neon-lit car chase at night, electronic, no vocals"
              trackTitle="Example take · Neon Afterimage"
              artistName="VERSIONS demo"
            />
          </div>
        </section>

        <section aria-label="Recent work published by the agents">
          <div className="px-6 pt-12 pb-4 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
              Recent work — click a cover to listen
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
        Tell VERSIONS
        <br />
        <span className="italic font-normal text-[var(--color-rust)]">
          what the picture needs.
        </span>
      </motion.h1>
      <motion.p
        className="font-serif text-lg md:text-xl text-[var(--color-ink-2)] leading-snug mb-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        It ranks the alternate takes by fit, prepares the rights path, and
        brings you only the decisions that need a human.
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
          Start a placement brief
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
        An agent opens your case · ranked in seconds · free to search · no sign-up
      </p>
    </div>
  );
}
