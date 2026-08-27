"use client";

// MODULAR: passive "how it works" strip for cold visitors. Four icon-led
// beats — the story is legible at a glance, zero interaction required.
// Verbose paragraphs were cut in favour of glyphs + one-liners; the
// steps stagger in on scroll via the shared motion grammar.

import { Stagger, StaggerItem } from "@/components/ui/motion";

const INK = "var(--color-ink)";
const RUST = "var(--color-rust)";

const STEPS = [
  {
    num: "01",
    title: "Hand it over",
    body: "Paste a brief or upload a take.",
    icon: (
      <g stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v10m0 0l-4-4m4 4l4-4" />
        <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </g>
    ),
  },
  {
    num: "02",
    title: "Agents rank it",
    body: "Three lenses score every take by fit.",
    icon: (
      <g stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round">
        <circle cx="10" cy="10" r="6" />
        <path d="M14.5 14.5 20 20" />
      </g>
    ),
  },
  {
    num: "03",
    title: "You make the call",
    body: "Creative direction stays human.",
    icon: (
      <g stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 12.5l3 3 5-6" stroke={RUST} />
      </g>
    ),
  },
  {
    num: "04",
    title: "Settled on Arc",
    body: "USDC splits, attributed per take.",
    icon: (
      <g stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M9 9.5h6M9 14.5h6M12 7v10" stroke={RUST} />
      </g>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-[var(--color-hair-strong)] px-4 py-8 sm:px-6 sm:py-10">
      {/* MODULAR: progressive disclosure — collapsed by default so the
          landing page reads as one funnel (brief → live proof); cold
          visitors who want the explainer open it on demand. */}
      <details className="group mx-auto max-w-4xl">
        <summary className="kicker mx-auto w-fit cursor-pointer list-none rounded-full px-4 py-2 text-center transition-colors hover:text-[var(--color-rust)]">
          <span className="group-open:hidden">How it works ▸</span>
          <span className="hidden group-open:inline">How it works ▾</span>
        </summary>
        <Stagger className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4 md:divide-x md:divide-[var(--color-hair)]">
          {STEPS.map((s) => (
            <StaggerItem key={s.num} className="md:px-6 first:md:pl-0 last:md:pr-0">
              <div className="float-y mb-3 inline-block" style={{ animationDelay: `${Number(s.num) * 0.7}s` }}>
                <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  {s.icon}
                </svg>
              </div>
              <div className="mb-1 font-mono text-[10px] text-[var(--color-rust)]">
                {s.num}
              </div>
              <div className="mb-1 font-serif text-lg font-medium">{s.title}</div>
              <p className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">
                {s.body}
              </p>
            </StaggerItem>
          ))}
        </Stagger>
        <p className="kicker mt-8 text-center">
          Artists submit alternate takes — the same agents publish the strong ones.
        </p>
      </details>
    </section>
  );
}
