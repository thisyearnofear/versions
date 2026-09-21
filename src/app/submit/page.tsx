import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageIntro } from "@/components/ui/PageIntro";
import { SupplyPanel } from "@/components/supply/SupplyPanel";
import { FadeIn } from "@/components/ui/FadeIn";
import { ToastProvider } from "@/components/ui/Toast";
import { Container } from "@/components/ui/primitives";

export const metadata = {
  title: "List supply",
  description:
    "List a track or a product on VERSIONS. Free listings are used with required credit; paid listings are bought by channel operators with disclosure and tracking built in.",
};

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const kindParam = sp.kind;
  const initialKind =
    (Array.isArray(kindParam) ? kindParam[0] : kindParam) === "placement" ? "placement" : "music";

  return (
    <ToastProvider>
      <div className="flex flex-col flex-1">
        <SiteHeader active="supply" />
        <main className="flex-1">
          <Container size="wide" className="py-10">
            <FadeIn>
              <PageIntro
                eyebrow="Supply"
                title="Put your work in the right context."
                intro="Create a music or product listing, choose its terms, and follow its use from one place. Existing uploads can be listed immediately; new audio uploads use the paid review flow."
              />
            </FadeIn>
            <FadeIn delay={0.08}>
              <SupplyPanel initialKind={initialKind} />
            </FadeIn>
          </Container>
        </main>
      </div>
      <SiteFooter />
    </ToastProvider>
  );
}
