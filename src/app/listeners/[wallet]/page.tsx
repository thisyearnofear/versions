import { SiteHeader } from "@/components/SiteHeader";
import { ListenerDashboard } from "@/components/listener/ListenerDashboard";
import { ToastProvider } from "@/components/ui/Toast";

// MODULAR: Listener dashboard page. Shows play history, badge showcase,
// reputation stats, and free play status for a given wallet.

export default async function ListenerPage({
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
          <ListenerDashboard wallet={wallet} />
        </main>
      </div>
    </ToastProvider>
  );
}
