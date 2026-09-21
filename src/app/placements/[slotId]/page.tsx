import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Container } from "@/components/ui/primitives";
import { ToastProvider } from "@/components/ui/Toast";
import { PlacementWorkspace } from "@/components/placements/PlacementWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Placement",
  description: "A paid placement on VERSIONS — review, pay, publish, report delivery, settle.",
};

export default async function PlacementPage({
  params,
}: {
  params: Promise<{ slotId: string }>;
}) {
  const { slotId } = await params;
  return (
    <ToastProvider>
      <div className="flex min-h-[100dvh] flex-1 flex-col">
        <SiteHeader active="channels" />
        <main className="flex-1 py-10">
          <Container size="wide">
            <PlacementWorkspace slotId={slotId} />
          </Container>
        </main>
        <SiteFooter />
      </div>
    </ToastProvider>
  );
}
