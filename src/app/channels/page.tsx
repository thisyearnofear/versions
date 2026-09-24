import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { ChannelProbePanel } from "@/components/channels/ChannelProbePanel";
import { ChannelOnboarding } from "@/components/channels/ChannelOnboarding";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export default function ChannelsPage() {
  return (
    <ToastProvider>
      <div className="flex flex-1 flex-col">
        <SiteHeader active="channels" />
        <main className="flex-1">
          <Container className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Channels"
                title="Where supply runs — and where you get paid."
                intro="Paste your YouTube URL, see what fits your channel in one click — no account, no wallet. Verify to unlock paid placements. Every paid use settles 60% supplier · 30% to your channel · 10% platform on Arc."
              />
            </FadeIn>

            {/* Guest-first: rank the catalog against this channel, no auth. */}
            <FadeIn delay={0.06}>
              <ChannelProbePanel />
            </FadeIn>

            {/* Save & verify — the persistence + paid-unlock rung. */}
            <FadeIn delay={0.12}>
              <div className="mt-8">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                  Save & verify — make it yours
                </h2>
                <p className="mt-1 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
                  Connect the channel you pasted above to your account. Verified reach is what unlocks paid placements — self-reported numbers are never accepted.
                </p>
                <div className="mt-3">
                  <ChannelOnboarding />
                </div>
              </div>
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
