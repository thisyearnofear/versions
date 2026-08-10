import { SiteHeader } from "@/components/SiteHeader";
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
              <h2 className="mb-2 text-center font-serif text-3xl font-black tracking-tight md:text-4xl">
                The feed.
              </h2>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mb-10 text-center font-serif text-base text-[var(--color-ink-2)]">
                AI-reviewed tracks, cleared for sync.
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <FeedView initialRows={initialRows} />
            </FadeIn>
          </Container>
        </main>
      </div>
    </ToastProvider>
  );
}
