"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  createRequestScope,
  marketplaceRequest,
  searchHref,
  browseHref,
  type MarketplaceListing,
} from "@/lib/marketplace-client";
import { DEMO_CHANNELS, rankDemoListings } from "@/lib/demo-catalog";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { PublishingKit } from "@/components/marketplace/PublishingKit";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { AGREEMENT_VERSION } from "@/lib/agreement";

const CONTEXT_CHIPS: Array<{ label: string; query: string }> = [
  { label: "Late-night study", query: DEMO_CHANNELS[0].query },
  { label: "Morning routine", query: DEMO_CHANNELS[1].query },
  { label: "Night drive", query: DEMO_CHANNELS[2].query },
];

interface SearchResult {
  total: number;
  mode: "semantic" | "tag" | "recent";
  rows: MarketplaceListing[];
  degraded?: boolean;
}

function pricingLabel(l: MarketplaceListing): string {
  if (l.tier === "free") return "Free · required credit";
  const p = l.pricing;
  if (p?.model === "flat" && p.flatFeeUsdc) return `Paid · ${p.flatFeeUsdc} USDC flat`;
  if (p?.model === "cpm" && p.cpmUsdc) return `Paid · ${p.cpmUsdc} USDC CPM`;
  return "Paid placement";
}

export function LandingExperience() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");
  const [context, setContext] = useState(CONTEXT_CHIPS[0]);
  const [rows, setRows] = useState<MarketplaceListing[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scope] = useState(() => createRequestScope());

  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;

  const loadMatches = useCallback(
    (query: string) => {
      const { signal, isCurrent } = scope.start();
      setLoading(true);
      (async () => {
        // DEMO FALLBACK: when the catalog DB is unreachable (or errors),
        // serve the static demo catalog so the hero always demonstrates the
        // loop — one unified listing primitive matched to a channel vibe.
        // Live rows win whenever they exist; demo rows are demo-labeled.
        const showDemo = () => {
          if (!isCurrent()) return;
          setRows(rankDemoListings(query, 4));
          setSelectedId(null);
          setDemo(true);
          setSearchError(null);
          setLoading(false);
        };
        try {
          const data = await marketplaceRequest<SearchResult>(
            searchHref({ q: query }, 0).replace("limit=20", "limit=4"),
            { signal },
          );
          if (!isCurrent()) return;
          const live = data.rows ?? [];
          if (live.length > 0) {
            setRows(live);
            setSelectedId(null);
            setDemo(false);
            setSearchError(null);
            setLoading(false);
            return;
          }
          if (data.degraded) {
            showDemo();
            return;
          }
          // Live but genuinely empty (no matches for this query): honest
          // empty state, not demo rows — don't fake supply that isn't there.
          setRows([]);
          setSelectedId(null);
          setDemo(false);
          setSearchError(null);
          setLoading(false);
        } catch {
          if (!isCurrent()) return;
          showDemo();
        }
      })();
    },
    [scope],
  );

  useEffect(() => {
    const t = window.setTimeout(() => loadMatches(context.query), 0);
    return () => {
      window.clearTimeout(t);
      scope.cancel();
    };
  }, [context, loadMatches, scope]);

  // MODULAR: hero search routes to the marketplace browse (?q=), not the
  // legacy supervisor brief search (?brief=). Music + placements rank by
  // channel-ethos semantic / tag match on /discover; ?brief= stays the
  // supervisor deep-link for the brief-search rail lower on that page.
  const submit = (t: string) => {
    const trimmed = t.trim();
    if (trimmed.length < 2) return;
    track("hero_brief_search", { len: trimmed.length });
    router.push(browseHref({ q: trimmed }));
  };

  return (
    <main className="flex-1">
      <section className="px-4 sm:px-6" aria-label="Find your fit">
        <div className="mx-auto grid max-w-6xl gap-10 py-12 md:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          <div>
            <p className="kicker kicker--accent mb-3">Music + product placements</p>
            <h1 className="font-serif text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl md:text-6xl">
              Music and products that belong on your channel.
            </h1>
            <p className="mt-4 max-w-lg font-serif text-base leading-snug text-[var(--color-ink-2)] sm:text-lg">
              Find listings that fit what you publish. Use free listings with the required credit, or
              buy a paid placement with clear pricing, disclosure, and tracking.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(q);
              }}
              className="card-surface mt-6 flex flex-col gap-2 p-2 sm:flex-row sm:items-stretch sm:gap-0 sm:p-1.5"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Describe what your channel publishes…"
                aria-label="Search the catalog"
                enterKeyHint="search"
                className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] bg-transparent px-4 py-3 font-serif text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none"
              />
              <button type="submit" disabled={q.trim().length < 2} className="btn-primary w-full sm:w-auto">
                Find my fit
              </button>
            </form>
            <Link href="/submit" className="btn-secondary mt-3 inline-block">
              List a track or product →
            </Link>

            <p className="marketplace-label mt-8">Example channel context · live catalog matches</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Example channel contexts">
              {CONTEXT_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={context.label === chip.label}
                  onClick={() => setContext(chip)}
                  className={cn(
                    "min-h-[44px] rounded-full border px-4 font-mono text-[12px] uppercase tracking-wide",
                    context.label === chip.label
                      ? "border-[var(--color-rust)] bg-[var(--color-rust)] text-[var(--color-paper)]"
                      : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <motion.div
            layout={!reduce}
            className="marketplace-stage min-w-0 rounded-[var(--radius-lg)] border border-[var(--color-hair)] bg-[var(--color-ink)] p-4 sm:p-6"
          >
            {loading ? (
              <div aria-live="polite">
                <div className="aspect-[4/3] w-full animate-pulse rounded-[var(--radius-md)] bg-[var(--color-paper)]/10" />
                <p className="mt-4 font-serif text-[15px] text-[var(--color-paper-2)]">
                  Matching “{context.label}” against the live catalog…
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-11 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-paper)]/10" />
                  ))}
                </div>
              </div>
            ) : searchError ? (
              <div className="flex min-h-[16rem] flex-col items-start justify-center">
                <p role="alert" className="font-serif text-[15px] text-[var(--color-paper-2)]">
                  {searchError}
                </p>
                <Link
                  href={browseHref({ q: context.query })}
                  className="btn-primary mt-4 inline-block bg-[var(--color-paper)] text-[var(--color-ink)] hover:opacity-90"
                >
                  Browse the catalog instead →
                </Link>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex min-h-[16rem] flex-col items-start justify-center">
                <p className="font-serif text-[15px] text-[var(--color-paper-2)]">
                  No live matches for this context yet.
                </p>
                <Link
                  href={browseHref()}
                  className="btn-primary mt-4 inline-block bg-[var(--color-paper)] text-[var(--color-ink)] hover:opacity-90"
                >
                  Browse everything →
                </Link>
              </div>
            ) : (
              <div>
                {demo && (
                  <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-hair-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-paper-2)]">
                    <span aria-hidden="true">●</span> Demo preview — live catalog unreachable
                  </p>
                )}
                {selected && (
                  <motion.div
                    key={selected.id}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.2 }}
                  >
                    <ListingMedia
                      key={selected.id}
                      title={selected.title}
                      kind={selected.kind}
                      audioPath={selected.audio_path}
                      images={selected.images}
                      coverSvg={selected.cover_svg}
                      priority
                    />
                    <div className="mt-3">
                      {demo ? (
                        <span className="font-serif text-lg font-bold text-[var(--color-paper)]">
                          {selected.title}
                        </span>
                      ) : (
                        <Link
                          href={`/listings/${selected.id}`}
                          className="font-serif text-lg font-bold text-[var(--color-paper)] hover:text-[var(--color-rust)]"
                        >
                          {selected.title}
                        </Link>
                      )}
                      <p className="font-serif text-[14px] text-[var(--color-paper-2)]">
                        {selected.supplier_name} · {pricingLabel(selected)}
                      </p>
                      {selected.why_fits?.[0] ? (
                        <p className="mt-1 font-serif text-[13px] italic text-[var(--color-paper-2)]">
                          {selected.why_fits[0]}
                        </p>
                      ) : (
                        selected.tags.length > 0 && (
                          <p className="mt-1 font-mono text-[12px] text-[var(--color-paper-2)]">
                            {selected.tags.slice(0, 4).join(" · ")}
                          </p>
                        )
                      )}
                    </div>
                  </motion.div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Matched listings">
                  {rows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      aria-pressed={(selected?.id ?? "") === r.id}
                      className={cn(
                        "min-h-[44px] rounded-[var(--radius-md)] border px-2 py-2 text-left font-serif text-[13px] leading-tight",
                        (selected?.id ?? "") === r.id
                          ? "border-[var(--color-rust)] text-[var(--color-paper)]"
                          : "border-[var(--color-hair-strong)] text-[var(--color-paper-2)] hover:text-[var(--color-paper)]",
                      )}
                    >
                      {r.title}
                      <span className="block font-mono text-[10px] uppercase tracking-wide opacity-70">
                        {r.kind} · {r.tier}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Link
              href={browseHref({ q: context.query })}
              className="mt-4 inline-block font-mono text-[12px] uppercase tracking-wide text-[var(--color-paper-2)] underline hover:text-[var(--color-paper)]"
            >
              All matches for “{context.label}” →
            </Link>
          </motion.div>
        </div>
      </section>

      <section
        className="border-y border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] px-4 py-12 sm:px-6"
        aria-labelledby="landing-beats"
      >
        <div className="mx-auto max-w-5xl">
          <h2 id="landing-beats" className="font-serif text-2xl font-black tracking-tight sm:text-3xl">
            From a good fit to a clear record.
          </h2>
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <ol className="divide-y divide-[var(--color-hair-strong)] border-y border-[var(--color-hair-strong)]">
              <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 py-5">
                <span className="font-serif text-3xl font-black tracking-tight text-[var(--color-ink-3)]">01</span>
                <div>
                  <p className="font-serif text-lg font-bold text-[var(--color-ink)]">Find what belongs</p>
                  <p className="mt-1 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                    Browse one catalog of tracks and products ranked against your channel&apos;s ethos —
                    {selected ? ` like “${selected.title}” above` : " like the matches above"}. Every card
                    shows the listing, its supplier, and why it surfaced.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 py-5">
                <span className="font-serif text-3xl font-black tracking-tight text-[var(--color-ink-3)]">02</span>
                <div>
                  <p className="font-serif text-lg font-bold text-[var(--color-ink)]">Get ready to publish</p>
                  <p className="mt-1 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                    Free listings hand you the exact credit line to paste. Paid placements mint a
                    tracking link and disclosure when the slot activates — nothing to draft yourself.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 py-5">
                <span className="font-serif text-3xl font-black tracking-tight text-[var(--color-ink-3)]">03</span>
                <div>
                  <p className="font-serif text-lg font-bold text-[var(--color-ink)]">Keep the record</p>
                  <p className="mt-1 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                    When you report a use, its record shows where it ran and who reported it.
                  </p>
                </div>
              </li>
            </ol>

            <div className="lg:pt-1">
              <p className="marketplace-label mb-2">
                Publishing kit · {selected ? selected.title : "no match loaded"}
                {demo && selected ? " · demo" : ""}
              </p>
              {selected ? (
                <div>
                  {selected.tier === "paid" && (
                    <p className="mb-2 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-3)]">
                      Attribution preview · tracking link becomes available after activation
                    </p>
                  )}
                  <PublishingKit
                    key={selected.id}
                    attributionText={selected.attribution_text}
                    trackingUrl={selected.tier === "free" ? selected.attribution_url : null}
                    disclosure={selected.tier === "paid" ? selected.disclosure : null}
                    linkLabel={selected.tier === "free" ? "Attribution link" : "Tracking link"}
                    reportHint={false}
                  />
                </div>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-hair-strong)] p-5">
                  <p className="font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
                    When a live match is selected above, its exact attribution and terms appear here —
                    the same material a channel operator copies.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6" aria-labelledby="landing-supply">
        <div className="mx-auto max-w-5xl">
          <h2 id="landing-supply" className="font-serif text-2xl font-black tracking-tight sm:text-3xl">
            Have something worth placing?
          </h2>
          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="border-t-2 border-[var(--color-ink)] pt-4">
              <h3 className="font-serif text-xl font-bold">Let your work travel with its credit.</h3>
              <p className="mt-2 max-w-md font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                List a track once under the blanket agreement. Free uses carry your generated credit
                line; paid placements settle 60% to you on every dollar the channel spends.
              </p>
              <Link href="/submit?kind=music" className="btn-secondary mt-4 inline-block">
                List a track →
              </Link>
            </div>
            <div className="border-t border-[var(--color-hair-strong)] pt-4 md:border-t-2 md:border-[var(--color-ink)]">
              <h3 className="font-serif text-xl font-bold">Put your product in the right context.</h3>
              <p className="mt-2 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                List a product once. Channels can find products that fit what they publish. Paid
                placements include the required disclosure.
              </p>
              <Link href="/submit?kind=placement" className="btn-secondary mt-4 inline-block">
                List a product →
              </Link>
            </div>
          </div>
          <p className="mt-8 max-w-2xl border-t border-[var(--color-hair)] pt-4 font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
            Who buys today: the channel operator. Paid placements are bought by the channel publishing
            the content — spend is allocated 60% to the supplier, 30% to the channel, and 10% to
            VERSIONS, settled in USDC on Arc.
          </p>
        </div>
      </section>

      <section
        className="border-t border-[var(--color-hair-strong)] px-4 py-12 sm:px-6"
        aria-labelledby="landing-proof"
      >
        <div className="mx-auto max-w-5xl">
          <h2 id="landing-proof" className="font-serif text-2xl font-black tracking-tight sm:text-3xl">
            What we can show you.
          </h2>
          <dl className="mt-6 divide-y divide-[var(--color-hair)] border-y border-[var(--color-hair)]">
            <div className="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
              <dt className="marketplace-label self-start pt-0.5">Reach</dt>
              <dd className="font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                Paid placements unlock only for channels with platform-verified reach — numbers pulled
                from the platform API, never self-reported. Pending channels can browse and use free
                listings; paid placements require platform verification.{" "}
                <Link href="/channels" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
                  Verify a channel →
                </Link>
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
              <dt className="marketplace-label self-start pt-0.5">Delivery</dt>
              <dd className="font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                Usage rows record where a use ran and who reported it — channel-reported and
                platform-reported rows are labeled as such, never blended into a single claim.
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
              <dt className="marketplace-label self-start pt-0.5">Settlement</dt>
              <dd className="font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
                Paid placements settle per leg on Arc: flat fees on activation, CPM budgets against
                delivered spend with unused funds returned. Demo settlements are labeled demo.{" "}
                <Link href="/legal/agreement" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
                  Read the terms ({AGREEMENT_VERSION}) →
                </Link>
              </dd>
            </div>
          </dl>
          <Link href={browseHref()} className="btn-primary mt-8 inline-block">
            Browse the catalog →
          </Link>
        </div>
      </section>
    </main>
  );
}
