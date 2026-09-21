import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Container } from "@/components/ui/primitives";
import { ToastProvider } from "@/components/ui/Toast";
import { ChannelWorkspace } from "@/components/channels/ChannelWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Channel",
  description: "A distribution channel on VERSIONS — verified reach, matched listings, placements.",
};

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  return (
    <ToastProvider>
      <div className="flex min-h-[100dvh] flex-1 flex-col">
        <SiteHeader active="channels" />
        <main className="flex-1 py-10">
          <Container size="wide">
            <ChannelWorkspace channelId={channelId} />
          </Container>
        </main>
        <SiteFooter />
      </div>
    </ToastProvider>
  );
}
