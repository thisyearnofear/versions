import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { fetchListingById } from "@/lib/server-marketplace";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Container } from "@/components/ui/primitives";
import { ToastProvider } from "@/components/ui/Toast";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { BuyBox } from "@/components/marketplace/BuyBox";
import { PublishingKit } from "@/components/marketplace/PublishingKit";
import { KitBar } from "@/components/marketplace/KitBar";
import { APP_URL } from "@/lib/attribution";

export const dynamic = "force-dynamic";

const getListing = cache(async (id: string) => fetchListingById(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const row = await getListing(id);
  const url = `${APP_URL}/listings/${id}`;
  if (!row) {
    return { title: "Listing not found", robots: { index: false, follow: false } };
  }
  const tierLine =
    row.tier === "free"
      ? "free with attribution"
      : row.pricing?.model === "flat"
        ? `paid · flat ${row.pricing.flatFeeUsdc} USDC`
        : `paid · CPM ${row.pricing?.cpmUsdc} USDC`;
  const description =
    row.summary ??
    `${row.kind === "music" ? "Track" : "Product placement"} "${row.title}" by ${row.supplier_name} on VERSIONS — ${tierLine}.`;
  return {
    title: `${row.title} — ${row.supplier_name}`,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: `${row.title} — ${row.supplier_name}`, description },
  };
}

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const channelId = typeof sp.channelId === "string" ? sp.channelId : "";
  const row = await getListing(id);
  if (!row) return notFound();

  const tierLabel =
    row.tier === "free"
      ? "free with attribution"
      : row.pricing?.model === "flat"
        ? `paid · flat ${row.pricing.flatFeeUsdc} USDC`
        : `paid · CPM ${row.pricing?.cpmUsdc} USDC`;

  const isActive = row.status === "active";

  return (
    <ToastProvider>
      <div className="flex min-h-[100dvh] flex-col">
        <SiteHeader active="browse" />
        <main className="flex-1 py-10">
          <Container size="wide">
            <p className="mb-4 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)]">
              <Link
                href={channelId ? `/discover?channelId=${encodeURIComponent(channelId)}` : "/discover"}
                className="hover:text-[var(--color-rust)]"
              >
                ← Browse
              </Link>
            </p>

            {/* Two-column: editorial left, commerce right (BuyBox is sticky on lg) */}
            <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
              <div className="min-w-0">
                <p className="kicker">
                  {row.kind === "music" ? "Music" : "Product placement"} · {tierLabel}
                  {row.status !== "active" ? ` · ${row.status}` : ""}
                </p>
                <h1 className="mt-2 font-serif text-3xl font-black tracking-tight">{row.title}</h1>
                <p className="mt-1 font-serif text-lg text-[var(--color-ink-2)]">
                  <Link
                    href={`/discover?kind=${row.kind}`}
                    className="hover:text-[var(--color-rust)] hover:underline"
                    title={`Browse more ${row.kind === "music" ? "tracks" : "placements"}`}
                  >
                    {row.supplier_name}
                  </Link>
                  <span className="font-mono text-[12px] text-[var(--color-ink-3)]"> — supplier</span>
                </p>
                {row.summary && (
                  <p className="mt-3 max-w-2xl font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                    {row.summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/discover?q=${encodeURIComponent(t)}`}
                      className="rounded-full bg-[var(--color-paper-2)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-rust)] hover:text-white"
                    >
                      {t}
                    </Link>
                  ))}
                </div>

                <div className="mt-6">
                  <ListingMedia
                    title={row.title}
                    kind={row.kind}
                    audioPath={row.audio_path}
                    images={row.images}
                    coverSvg={row.cover_svg}
                  />
                </div>

                {/* What you actually get — de-prioritized below the fold, honest */}
                {isActive && row.kind === "music" && row.audio_path && (
                  <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-3)]">
                    Audio preview above — the file link is in your kit / the BuyBox credit panel after you copy.
                  </p>
                )}

                {/* Keep the full PublishingKit as the archival reference — collapsed visually vs BuyBox */}
                {isActive && (
                  <div className="mt-8 border-t border-[var(--color-hair)] pt-6">
                    <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                      Full publishing kit — reference
                    </h2>
                    <p className="mt-1 font-serif text-[13px] leading-snug text-[var(--color-ink-3)]">
                      The BuyBox is the decision. This is the archival record — same credit, same links, same disclosure.
                    </p>
                    <div className="mt-3">
                      <PublishingKit
                        attributionText={row.attribution_text}
                        trackingUrl={row.tier === "paid" ? row.attribution_url : row.attribution_url}
                        linkLabel={row.tier === "paid" ? "Tracking link" : "Attribution link"}
                        disclosure={row.disclosure}
                        audioPath={row.audio_path}
                        images={row.images}
                        reportHint={false}
                      />
                    </div>
                  </div>
                )}

                {!isActive && (
                  <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] px-4 py-3">
                    <p className="font-serif text-[14px] text-[var(--color-ink-2)]">
                      This listing is <strong className="font-semibold text-[var(--color-ink)]">{row.status}</strong> and not taking new uses right now.{" "}
                      <Link href="/discover" className="text-[var(--color-rust)] underline">
                        Browse what&apos;s live
                      </Link>
                      .
                    </p>
                  </div>
                )}
              </div>

              <aside className="min-w-0">
                <BuyBox listing={row} initialChannelId={channelId} />
              </aside>
            </div>
          </Container>
        </main>
        <SiteFooter />
        <KitBar />
      </div>
    </ToastProvider>
  );
}
