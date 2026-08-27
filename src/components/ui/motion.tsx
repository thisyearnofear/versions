"use client";

// MODULAR: shared scroll/motion primitives — the vocabulary for every
// animated surface. One easing curve, one entrance pattern, viewport-
// triggered by default, and everything honours reduced-motion via the
// global MotionConfig (providers.tsx). Prefer these over hand-rolled
// motion.div blocks so the product moves with ONE grammar.

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Fade-up reveal when scrolled into view (fires once). */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const staggerChild: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

/** Staggered group: children pop in sequence when the group scrolls in. */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={staggerChild} className={className}>
      {children}
    </motion.div>
  );
}

/** SVG path that draws itself when scrolled into view. */
export function DrawPath({
  d,
  className,
  delay = 0,
  duration = 1.1,
  strokeWidth = 1.5,
}: {
  d: string;
  className?: string;
  delay?: number;
  duration?: number;
  strokeWidth?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      initial={reduce ? false : { pathLength: 0, opacity: 0 }}
      whileInView={{ pathLength: 1, opacity: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration, delay, ease: "easeInOut" }}
    />
  );
}

/** 3D tilt on pointer move — the card leans toward the cursor.
 *  Reduces to a static card under reduced-motion. */
export function Tilt({
  children,
  className,
  max = 8,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <div className={cn("tilt-wrap", className)}>
      <motion.div
        ref={ref}
        className="tilt-inner"
        onMouseMove={(e) => {
          const el = ref.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          el.style.transform = `rotateY(${(px - 0.5) * max * 2}deg) rotateX(${(0.5 - py) * max * 2}deg)`;
        }}
        onMouseLeave={() => {
          const el = ref.current;
          if (el) el.style.transform = "rotateY(0) rotateX(0)";
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
