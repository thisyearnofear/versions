import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { SubmitForm } from "@/components/submit/SubmitForm";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function SubmitPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="artists" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="For Artists"
                title="Hand an alternate take to your Release Agent."
                intro="Upload the audio — the agent prepares the release record, flags what's missing, and routes it to curation when you approve."
              />
            </FadeIn>
            <FadeIn delay={0.15}>
              <SubmitForm />
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
