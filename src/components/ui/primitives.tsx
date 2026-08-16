"use client";

// MODULAR: shared layout & type primitives for the "centred, compact,
// intuitive" pass. Four building blocks that enforce one rhythm and one
// hierarchy across pages:
//   Container  — guarantees a centred content column (narrow/default/wide).
//   Section    — owns vertical rhythm + a calm divider + heading hierarchy.
//   Eyebrow    — the ONE disciplined micro-label (reserve for section labels).
//   Card       — the one list/item container (uniform border + padding).
// Behaviourally neutral — pure presentation. Keep the ad-hoc
// font-mono-9px-uppercase-by-hand pattern OUT of components; use these.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Container({
  children,
  className,
  size = "default",
}: {
  children: ReactNode;
  className?: string;
  size?: "narrow" | "default" | "wide";
}) {
  return (
    <div className={cn("mx-auto w-full px-6 md:px-8", size === "narrow" && "max-w-2xl", size === "default" && "max-w-3xl", size === "wide" && "max-w-5xl", className)}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  // MODULAR: shared micro-label. Two sizes up from the old 9-10px ad-hoc
  // caps so section + page headers stay legible (WCAG-friendly small text)
  // while preserving the mono/uppercase editorial flavour.
  return (
    <p className={cn("font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]", className)}>
      {children}
    </p>
  );
}

export function Section({
  children,
  className,
  eyebrow,
  title,
  intro,
  divider = true,
  id,
}: {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title?: string;
  intro?: string;
  divider?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn(divider && "border-t border-[var(--color-hair)]", "py-10", className)}>
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      {title && <h2 className="mb-1 font-serif text-2xl font-black tracking-tight md:text-3xl">{title}</h2>}
      {intro && <p className="mb-5 font-serif text-sm leading-snug text-[var(--color-ink-2)]">{intro}</p>}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border border-[var(--color-hair-strong)] p-5", className)}>
      {children}
    </div>
  );
}