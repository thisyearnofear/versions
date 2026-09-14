import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { SubmitForm } from "@/components/submit/SubmitForm";
import { SupplyCreator } from "@/components/supply/SupplyCreator";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function SubmitPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="supply" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Supply"
                title="List a track or a product — live immediately."
                intro="One blanket agreement, one click-through at creation. A music listing reuses your uploaded track; a placement listing carries its own images. Choose free with attribution or set a flat fee / CPM — paid slots mint a tracking code and carry disclosure from day one."
              />
            </FadeIn>
            <FadeIn delay={0.08}>
              <SupplyCreator />
            </FadeIn>
            <FadeIn delay={0.14}>
              <div className="mt-10 border-t border-[var(--color-hair)] pt-8">
                <p className="kicker mb-4">Upload a track</p>
                <SubmitForm />
              </div>
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
