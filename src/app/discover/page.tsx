import { SiteHeader } from "@/components/SiteHeader";
import { DiscoverView } from "@/components/discovery/DiscoverView";
import { ToastProvider } from "@/components/ui/Toast";

export default function DiscoverPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="discover" />
        <main className="flex-1 px-6 md:px-12 py-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Section 04 — Agent Economy
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Discover.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            The A&amp;R agent curates playlists from the published catalog. Each
            play pays the artist $0.0005 USDC on Arc — agent-to-agent economics,
            settled instantly.
          </p>
          <DiscoverView />
        </main>
      </div>
    </ToastProvider>
  );
}
