import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { CaseDetailView } from "@/components/cases/CaseDetailView";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="workspace" />
        <main className="flex-1">
          <Container className="py-10">
            <PageIntro
              eyebrow="Placement case"
              title="One decision at a time."
              intro="The brief, the agent's progress, and the full trail of what it did for you. Only your judgment moves it forward."
            />
            <Suspense
              fallback={
                <div className="py-16 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                  Loading…
                </div>
              }
            >
              <CaseDetailView id={id} />
            </Suspense>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}