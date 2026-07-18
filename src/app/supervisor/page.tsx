import { SiteHeader } from "@/components/SiteHeader";
import { SupervisorDashboard } from "@/components/supervisor/SupervisorDashboard";
import { ToastProvider } from "@/components/ui/Toast";

export default function SupervisorPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="supervisor" />
        <main className="flex-1 px-6 md:px-12 py-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-rust)] mb-4">
            Supervisor workspace
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-black tracking-tight mb-6">
            Your sync dashboard.
          </h2>
          <p className="font-serif text-lg text-[var(--color-ink-2)] leading-snug max-w-2xl mb-12">
            Save briefs, revisit recent searches, and track tracks you are
            considering for sync. Connect your wallet to persist everything.
          </p>
          <SupervisorDashboard />
        </main>
      </div>
    </ToastProvider>
  );
}
