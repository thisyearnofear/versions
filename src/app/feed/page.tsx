import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
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
        <SiteHeader active="library" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Library"
                title="Tracks, briefs, and prior work."
                intro="Browse the reviewed catalog. Guided-demo tracks are clearly labeled and do not represent cleared or license-ready offers."
              />
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
