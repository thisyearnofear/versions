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
              eyebrow="Workspace"
              title="Cases, placements, and proof."
              intro="Shortlists, licenses, and live placements in one place — plus the catalog and your usage proof. For channels, pair this with Channels to see supply filtered by your verified ethos."
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
