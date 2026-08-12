import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { JourneyRail } from "@/components/ui/JourneyRail";
import { PageIntro } from "@/components/ui/PageIntro";
import { SupervisorDashboard } from "@/components/supervisor/SupervisorDashboard";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function SupervisorPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="supervisor" />
        <main className="flex-1">
          <Container className="py-10" size="default">
            <PageIntro
              eyebrow="Supervisor workspace"
              title="Your licensing desk."
              intro="Save briefs, shortlist takes, request licenses, and settle the tracks that made the cut."
            >
              <JourneyRail variant="supervisor" active="License" />
            </PageIntro>
            <Suspense
              fallback={
                <div className="py-16 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                  Loading…
                </div>
              }
            >
              <SupervisorDashboard />
            </Suspense>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
