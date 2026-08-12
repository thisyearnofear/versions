import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { JourneyRail } from "@/components/ui/JourneyRail";
import { PageIntro } from "@/components/ui/PageIntro";
import { FeedView } from "@/components/feed/FeedView";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";
import { services } from "@/lib/services";
import { normalizeFeedRow, type FeedRow } from "@/lib/api-client";

async function loadInitialFeed(): Promise<FeedRow[]> {
  try {
    const result = await services().feed.listPublished({ limit: 20, offset: 0 });
    return (result.rows as unknown as Array<Record<string, unknown>>).map(normalizeFeedRow);
  } catch {
    return [];
  }
}

export default async function FeedPage() {
  const initialRows = await loadInitialFeed();
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="feed" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Published catalog"
                title="The tracks are cleared."
                intro="Browse AI-reviewed versions and move from a strong match to a license-ready take."
              >
                <JourneyRail variant="supervisor" active="Match" />
              </PageIntro>
            </FadeIn>
            <FadeIn delay={0.15}>
              <FeedView initialRows={initialRows} />
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
