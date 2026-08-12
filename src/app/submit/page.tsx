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
        <SiteHeader active="submit" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Artist submission"
                title="Put a version into the machine."
                intro="Submit an alternate take, verify the fee, and hand the track to the agents."
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
