import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { listings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Container } from "@/components/ui/primitives";
import { APP_URL } from "@/lib/attribution";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page — one query per request.
const getListing = cache(async (id: string) => {
  const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return row;
});

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
    `${row.kind === "music" ? "Track" : "Product placement"} "${row.title}" by ${row.supplierName} on VERSIONS — ${tierLine}.`;
  return {
    title: `${row.title} — ${row.supplierName}`,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: `${row.title} — ${row.supplierName}`, description },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getListing(id);
  if (!row) return notFound();

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader />
      <main className="flex-1 py-10">
        <Container>
          <p className="kicker">{row.kind} · {row.tier === "free" ? "free with attribution" : row.pricing?.model === "flat" ? `paid · flat ${row.pricing.flatFeeUsdc} USDC` : `paid · CPM ${row.pricing?.cpmUsdc} USDC`}</p>
          <h1 className="mt-2 font-serif text-3xl font-black tracking-tight">{row.title}</h1>
          <p className="font-serif text-lg text-[var(--color-ink-2)]">{row.supplierName}</p>
          {row.summary && <p className="mt-3 max-w-2xl font-serif text-sm leading-snug text-[var(--color-ink-2)]">{row.summary}</p>}
          <div className="mt-3 flex flex-wrap gap-1">
            {(row.tags ?? []).map((t: string) => (
              <span key={t} className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">{t}</span>
            ))}
          </div>
          <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] p-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">Attribution</p>
            <p className="mt-1 break-words font-mono text-sm">{row.attributionText}</p>
            <p className="mt-2 break-all font-mono text-xs text-[var(--color-ink-3)]">{row.attributionUrl}</p>
            {row.disclosure && <p className="mt-2 font-mono text-xs text-[var(--color-rust)]">{row.disclosure.label} — {row.disclosure.statement}</p>}
          </div>
          {row.coverSvg && <div className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-[var(--color-paper-2)] p-2" dangerouslySetInnerHTML={{ __html: row.coverSvg }} />}
          {row.audioPath && <audio controls src={`/api/v1/uploads/${row.audioPath.split("/").pop()}`} className="mt-4 w-full" />}
          {row.images?.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {row.images.map((src: string) => <img key={src} src={src} alt="" className="w-full rounded object-cover" />)}
            </div>
          ) : null}
          <div className="mt-6 flex gap-3">
            <Link href="/discover" className="btn-primary">Browse more →</Link>
            <Link href="/legal/agreement" className="btn-secondary">Agreement</Link>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
