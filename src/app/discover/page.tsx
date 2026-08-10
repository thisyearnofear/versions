import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { DiscoverView } from "@/components/discovery/DiscoverView";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function DiscoverPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="discover" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <h2 className="mb-2 text-center font-serif text-3xl font-black tracking-tight md:text-4xl">
                Find the version.
              </h2>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mb-10 text-center font-serif text-base text-[var(--color-ink-2)]">
                Describe a scene in plain English — get ranked alternate takes
                for sync. Free to search, no wallet needed.
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <Suspense fallback={<DashboardFallback />}>
                <DiscoverView />
              </Suspense>
            </FadeIn>
          </Container>
        </main>
      </div>
    </ToastProvider>
  );
}

function DashboardFallback() {
  return (
    <div className="py-10 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
      Loading…
    </div>
  );
}
