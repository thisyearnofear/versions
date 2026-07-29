import { SiteHeader } from "@/components/SiteHeader";
import { AgentMonitor } from "@/components/curation/AgentMonitor";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { ToastProvider } from "@/components/ui/Toast";

export default function AgentsPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="agents" />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-5xl mx-auto w-full">
          <h2 className="font-serif text-3xl md:text-4xl font-black tracking-tight text-center mb-2">
            Agents.
          </h2>
          <p className="font-serif text-base text-[var(--color-ink-3)] text-center mb-10">
            Three AI agents review every track. No human in the loop.
          </p>
          <div className="grid lg:grid-cols-[1fr_360px] gap-12 items-start">
            <AgentMonitor />
            <aside className="lg:sticky lg:top-8">
              <EconomyTicker limit={10} />
            </aside>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
