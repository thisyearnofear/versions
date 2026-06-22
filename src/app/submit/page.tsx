import { SiteHeader } from "@/components/SiteHeader";
import { SubmitForm } from "@/components/submit/SubmitForm";
import { ToastProvider } from "@/components/ui/Toast";

export default function SubmitPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="submit" />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-4xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Section 01 — Submission
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Submit a version.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            A demo, a live take, the cut your label told you to bury. Upload the
            file and the metadata. The 0.50 USDC submission fee funds the curator
            pool — split 70/20/10 between curators, platform, and MusicBrainz
            attribution.
          </p>
          <SubmitForm />
        </main>
      </div>
    </ToastProvider>
  );
}
