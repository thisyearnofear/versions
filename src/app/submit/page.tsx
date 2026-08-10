import { SiteHeader } from "@/components/SiteHeader";
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
              <h2 className="mb-2 text-center font-serif text-3xl font-black tracking-tight md:text-4xl">
                Submit.
              </h2>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mb-10 text-center font-serif text-base text-[var(--color-ink-2)]">
                Drop your version. Get rated by AI.
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <SubmitForm />
            </FadeIn>
          </Container>
        </main>
      </div>
    </ToastProvider>
  );
}
