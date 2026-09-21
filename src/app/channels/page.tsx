import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { ChannelOnboarding } from "@/components/channels/ChannelOnboarding";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function ChannelsPage() {
  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="channels" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Channels"
                title="Where supply runs."
                intro="Connect your YouTube channel, confirm its reach, and find listings that fit what you publish. Your placements and delivery records stay together."
              />
            </FadeIn>
            <FadeIn delay={0.08}>
              <ChannelOnboarding />
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
