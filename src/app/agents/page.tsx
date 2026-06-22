import { SiteHeader } from "@/components/SiteHeader";
import { AgentMonitor } from "@/components/curation/AgentMonitor";
import { ToastProvider } from "@/components/ui/Toast";

export default function AgentsPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="agents" />
        <main className="flex-1 px-6 md:px-12 py-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Section 02 — Agent Reviews
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Three autonomous agents, one review.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            Production, Performance, and Market agents evaluate every submission
            automatically — no human in the loop. Watch the queue and inspect
            what each agent decided, then see the version publish once all three
            agree.
          </p>
          <AgentMonitor />
        </main>
      </div>
    </ToastProvider>
  );
}
