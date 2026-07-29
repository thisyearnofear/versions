import { SiteHeader } from "@/components/SiteHeader";
import { FeedView } from "@/components/feed/FeedView";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { services } from "@/lib/services";
import type { FeedRow } from "@/lib/api-client";

async function loadInitialFeed(): Promise<FeedRow[]> {
  try {
    const result = await services().feed.listPublished({ limit: 20, offset: 0 });
    return result.rows as unknown as FeedRow[];
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
        <main className="flex-1 px-6 md:px-12 py-12 max-w-4xl mx-auto w-full">
          <FadeIn>
            <h2 className="font-serif text-3xl md:text-4xl font-black tracking-tight text-center mb-2">
              The feed.
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="font-serif text-base text-[var(--color-ink-3)] text-center mb-10">
              AI-reviewed tracks, cleared for sync.
            </p>
          </FadeIn>
          <FadeIn delay={0.2}>
            <FeedView initialRows={initialRows} />
          </FadeIn>
        </main>
      </div>
    </ToastProvider>
  );
}
