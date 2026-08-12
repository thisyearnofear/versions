import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { JourneyRail } from "@/components/ui/JourneyRail";
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
              eyebrow="Agent curation"
              title="Watch consensus form."
              intro="Three specialized agents review every track, explain the verdict, and publish when the gate clears."
            >
              <JourneyRail variant="artist" active="Review" />
            </PageIntro>
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
