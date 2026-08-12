import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { AgentMonitor } from "@/components/curation/AgentMonitor";
import { EconomyTicker } from "@/components/economy/EconomyTicker";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";

export default function AgentsPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="agents" />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-5xl mx-auto w-full">
          <FadeIn>
            <PageIntro
              eyebrow="System · agent activity"
              title="Proof, not a product."
              intro="The audit surface behind your workspace — what the agents are doing across the platform, live, with every verdict and receipt recorded. The work happens in Workspace; this is the evidence."
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="grid lg:grid-cols-[1fr_360px] gap-12 items-start">
              <AgentMonitor />
              <aside className="lg:sticky lg:top-8">
                <EconomyTicker limit={10} />
              </aside>
            </div>
          </FadeIn>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
