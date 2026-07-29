import { SiteHeader } from "@/components/SiteHeader";
import { SubmitForm } from "@/components/submit/SubmitForm";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";

export default function SubmitPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="submit" />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-4xl mx-auto w-full">
          <FadeIn>
            <h2 className="font-serif text-3xl md:text-4xl font-black tracking-tight text-center mb-2">
              Submit.
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="font-serif text-base text-[var(--color-ink-3)] text-center mb-10">
              Drop your version. Get rated by AI.
            </p>
          </FadeIn>
          <FadeIn delay={0.2}>
            <SubmitForm />
          </FadeIn>
        </main>
      </div>
    </ToastProvider>
  );
}
