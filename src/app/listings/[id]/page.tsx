import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { services } from "@/lib/services";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Container } from "@/components/ui/primitives";
import { ToastProvider } from "@/components/ui/Toast";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { ListingActions } from "@/components/marketplace/ListingActions";
import { APP_URL } from "@/lib/attribution";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page — one query per request.
const getListing = cache(async (id: string) => services().listings.get(id));

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
            <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="min-w-0">
                <p className="kicker">
                  {row.kind === "music" ? "Music" : "Product placement"} · {tierLabel}
                  {row.status !== "active" ? ` · ${row.status}` : ""}
                </p>
                <h1 className="mt-2 font-serif text-3xl font-black tracking-tight">{row.title}</h1>
                <p className="font-serif text-lg text-[var(--color-ink-2)]">{row.supplier_name}</p>
                {row.summary && (
                  <p className="mt-3 max-w-2xl font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                    {row.summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1">
                  {row.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[12px] text-[var(--color-ink-2)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-5">
                  <ListingMedia
                    title={row.title}
                    kind={row.kind}
                    audioPath={row.audio_path}
                    images={row.images}
                    coverSvg={row.cover_svg}
                  />
                </div>
                {row.tier === "paid" && (
                  <p className="mt-3 font-mono text-[12px] text-[var(--color-ink-3)]">
                    {row.budget_remaining_usdc != null
                      ? `Campaign remaining: ${row.budget_remaining_usdc} USDC`
                      : "Uncapped campaign"}
                  </p>
                )}
              </div>
              <aside className="min-w-0">
                <ListingActions listing={row} initialChannelId={channelId} />
                <p className="mt-3 font-mono text-[12px] text-[var(--color-ink-3)]">
                  Uses and placements run under the{" "}
                  <Link
                    href="/legal/agreement"
                    className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]"
                  >
                    blanket agreement
                  </Link>
                  .
                </p>
              </aside>
            </div>
          </Container>
        </main>
        <SiteFooter />
      </div>
    </ToastProvider>
  );
}
