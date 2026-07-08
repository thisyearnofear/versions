"use client";

// MODULAR: Analytics provider. Mounts once at the app root via
// Providers. Initializes the flush listeners (pagehide /
// visibilitychange) and fires a page_view event on every
// pathname change so the funnel can be stitched server-side.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { initAnalytics, track } from "@/lib/analytics";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  // MODULAR: merged page_view tracking into a single effect.
  // When prevPath.current is null and pathname resolves, that IS
  // the initial page_view — fire it with initial: true. On
  // subsequent pathname changes, fire a transition view. This
  // eliminates the race where the separate []-deps effect could
  // miss the initial view if pathname was null on first render.
  useEffect(() => {
    if (!pathname) return;
    if (prevPath.current === pathname) return;
    const isInitial = prevPath.current === null;
    track("page_view", {
      from: prevPath.current,
      to: pathname,
      initial: isInitial,
    });
    prevPath.current = pathname;
  }, [pathname]);

  return <>{children}</>;
}
