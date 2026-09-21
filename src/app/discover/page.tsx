import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { DiscoverView } from "@/components/discovery/DiscoverView";
import { MarketplaceBrowse } from "@/components/discovery/MarketplaceBrowse";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

function firstString(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // MODULAR: two search rails share one page. ?q= feeds the marketplace
  // browse (hero deep-link, ethos-ranked music + placements); ?brief= feeds
  // the legacy supervisor brief search below it (track catalog + case thread).
  const sp = (await searchParams) ?? {};
  const legacyOpen = !!firstString(sp.brief) || firstString(sp.showcase) === "pilot";

  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="browse" />
        <main className="flex-1">
          <Container size="wide" className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Browse"
                title="Find listings that fit your channel."
                intro="Search the vibe you publish — tracks and product placements ranked to your channel's ethos. Free listings carry a required credit; paid placements show flat-fee or CPM pricing up front."
              />
            </FadeIn>
            <FadeIn delay={0.06}>
              <Suspense fallback={null}>
                <MarketplaceBrowse />
              </Suspense>
            </FadeIn>
            <details open={legacyOpen} className="mt-10 border-t border-[var(--color-hair)] pt-6">
              <summary className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)]">
                Advanced music briefs &amp; licenses
              </summary>
              <FadeIn delay={0.1}>
                <Suspense fallback={<DashboardFallback />}>
                  <DiscoverView />
                </Suspense>
              </FadeIn>
            </details>
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
