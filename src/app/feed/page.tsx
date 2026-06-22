import { SiteHeader } from "@/components/SiteHeader";
import { FeedView } from "@/components/feed/FeedView";
import { ToastProvider } from "@/components/ui/Toast";
import { services } from "@/lib/services";
import type { FeedRow } from "@/lib/api-client";

// MODULAR: server component — fetches the first page of the feed from the
// service layer (skips the HTTP round-trip) and passes it as initial
// hydration data. FeedView takes over after mount for client-side
// filtering. Errors degrade to an empty feed; FeedView will recover when
// the client can reach /api/v1/feed.
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
        <main className="flex-1 px-6 md:px-12 py-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Section 03 — Discover
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            The feed.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            Versions that have cleared the publish gate — at least three curators
            have rated them. Filter the taste graph to find your kind of take.
          </p>
          <FeedView initialRows={initialRows} />
        </main>
      </div>
    </ToastProvider>
  );
}
