"use client";

import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function PageIntro({
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8", className)}>
      <Eyebrow className="mb-3 text-[var(--color-rust)]">{eyebrow}</Eyebrow>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-black tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-2 max-w-2xl font-serif text-base leading-snug text-[var(--color-ink-2)]">{intro}</p>
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </div>
  );
}
