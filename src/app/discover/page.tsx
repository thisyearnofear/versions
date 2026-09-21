import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { DiscoverView } from "@/components/discovery/DiscoverView";
import { MarketplaceBrowse } from "@/components/discovery/MarketplaceBrowse";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function DiscoverPage({
  searchParams,
}: {
  searchParams?: { q?: string; brief?: string };
}) {
  // MODULAR: two search rails share one page. ?q= feeds the marketplace
  // browse (hero deep-link, ethos-ranked music + placements); ?brief= feeds
  // the legacy supervisor brief search below it (track catalog + case thread).
  const initialQuery = typeof searchParams?.q === "string" ? searchParams.q : "";
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="browse" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Browse"
                title="Music & placements, matched to your channel."
                intro="Describe the vibe you need — we surface tracks and sponsor slots that fit. Free use carries attribution; paid placements are a flat fee or CPM with a live budget cap."
              />
            </FadeIn>
            <FadeIn delay={0.06}>
              <MarketplaceBrowse initialQuery={initialQuery} />
            </FadeIn>
            <FadeIn delay={0.1}>
              <Suspense fallback={<DashboardFallback />}>
                <DiscoverView />
              </Suspense>
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}

function DashboardFallback() {
  return (
    <div className="py-10 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
      Loading…
    </div>
  );
}
