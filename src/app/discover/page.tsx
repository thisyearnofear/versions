import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { DiscoverView } from "@/components/discovery/DiscoverView";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function DiscoverPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="brief" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="New brief"
                title="Start a placement case."
                intro="Tell VERSIONS what the picture needs. It ranks the alternate takes by fit and prepares the rights path — then brings you the decision."
              />
            </FadeIn>
            <FadeIn delay={0.1}>
              <Suspense fallback={<DashboardFallback />}>
                <DiscoverView />
              </Suspense>
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
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
