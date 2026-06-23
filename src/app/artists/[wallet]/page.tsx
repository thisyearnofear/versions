import { SiteHeader } from "@/components/SiteHeader";
import { ArtistDashboard } from "@/components/artist/ArtistDashboard";
import { ToastProvider } from "@/components/ui/Toast";

// MODULAR: Artist dashboard page. Server component that renders
// the client-side dashboard for a given wallet address. The wallet
// param comes from the URL path — e.g. /artists/0x1234...

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;

  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader />
        <main className="flex-1 px-6 md:px-12 py-12 max-w-5xl">
          <ArtistDashboard wallet={wallet} />
        </main>
      </div>
    </ToastProvider>
  );
}
