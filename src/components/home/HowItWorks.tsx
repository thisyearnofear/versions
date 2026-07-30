"use client";

// MODULAR: passive "how it works" strip for cold visitors. Replaces the
// auto-opening Tour modal — the four-step story is now legible at a glance,
// zero interaction required, while the modal stays available on demand.

import { motion } from "framer-motion";

const STEPS = [
  { num: "01", title: "Connect", body: "Any EVM wallet. No gas — fees settle on Arc L1." },
  { num: "02", title: "Submit", body: "Upload a take. 0.50 USDC funds the curator pool." },
  { num: "03", title: "AI review", body: "Three agents rate it in seconds. No humans in the loop." },
  { num: "04", title: "Get paid", body: "Publish to the feed. Plays pay USDC instantly." },
];

export function HowItWorks() {
  return (
    <section className="border-t border-[var(--color-hair-strong)] px-6 py-10">
      <div className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)] mb-8">
        How it works
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 max-w-4xl mx-auto md:divide-x md:divide-[var(--color-hair)]">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.num}
            className="md:px-6 first:md:pl-0 last:md:pr-0"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.35 }}
          >
            <div className="font-mono text-[10px] text-[var(--color-rust)] mb-2">
              {s.num} ·
            </div>
            <div className="font-serif text-lg font-medium mb-1">{s.title}</div>
            <p className="font-serif text-sm text-[var(--color-ink-2)] leading-snug">
              {s.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
