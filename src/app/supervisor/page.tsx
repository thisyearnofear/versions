import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { SupervisorDashboard } from "@/components/supervisor/SupervisorDashboard";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function SupervisorPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="workspace" />
        <main className="flex-1">
          <Container className="py-10" size="default">
            <PageIntro
              eyebrow="Your workspace"
              title="The decisions that need you."
              intro="Cases, shortlists, and licenses in one place — plus the library. The agent does the legwork and brings you only what needs your judgment."
            />
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
