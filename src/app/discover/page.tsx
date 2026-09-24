import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { MarketplaceBrowse } from "@/components/discovery/MarketplaceBrowse";
import { KitBar } from "@/components/marketplace/KitBar";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function DiscoverPage() {
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
          </Container>
        </main>
      </div>
      <SiteFooter />
      {/* The kit is the guest's payoff — it rides with the shelf. */}
      <KitBar />
    </ToastProvider>
  );
}
