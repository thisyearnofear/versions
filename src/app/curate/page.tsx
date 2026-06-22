import { SiteHeader } from "@/components/SiteHeader";
import { CurateConsole } from "@/components/curation/CurateConsole";
import { ToastProvider } from "@/components/ui/Toast";

export default function CuratePage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="curate" />
        <main className="flex-1 px-6 md:px-12 py-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Section 02 — Curation
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Curate the queue.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            Three AI agent curators review each submission automatically — see
            what the Production, Performance, and Market agents said about each
            track in the queue.
          </p>
          <CurateConsole />
        </main>
      </div>
    </ToastProvider>
  );
}
