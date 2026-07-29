import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { DiscoverView } from "@/components/discovery/DiscoverView";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";

export default function DiscoverPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="discover" />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-4xl mx-auto w-full">
          <FadeIn>
            <h2 className="font-serif text-3xl md:text-4xl font-black tracking-tight text-center mb-2">
              Discover.
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="font-serif text-base text-[var(--color-ink-3)] text-center mb-10">
              Paste a brief. Find the track.
            </p>
          </FadeIn>
          <FadeIn delay={0.2}>
            <Suspense fallback={<DashboardFallback />}>
              <DiscoverView />
            </Suspense>
          </FadeIn>
        </main>
      </div>
    </ToastProvider>
  );
}

function DashboardFallback() {
  return (
    <div className="py-16 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
      Loading…
    </div>
  );
}
