"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAccount } from "wagmi";
import { MarketplaceError, createRequestScope, marketplaceRequest, mediaHref } from "@/lib/marketplace-client";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { agreementFor, AGREEMENT_VERSION } from "@/lib/agreement";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { SubmitForm } from "@/components/submit/SubmitForm";
import { ListingMedia } from "@/components/marketplace/ListingMedia";
import { WagmiConnectButton } from "@/components/wallet/WagmiConnectButton";

type Kind = "music" | "placement";
type Tier = "free" | "paid";
type PricingModel = "flat" | "cpm";

interface SubmissionLite { id: string; title: string; artistName: string; audioPath: string; coverSvg?: string | null }

function formatError(err: unknown): string {
  if (err instanceof MarketplaceError) return err.message;
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function SupplyCreator({
  initialKind = "music",
  onCreated,
}: {
  initialKind?: Kind;
  onCreated?: () => void;
}) {
  const { address } = useAccount();
  const { isAuthenticated: isAuthed, walletAddress } = useSupervisorAuth();
  const { showToast } = useToast();

  const [kind, setKind] = useState<Kind>(initialKind);
  const [title, setTitle] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [summary, setSummary] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [imagesRaw, setImagesRaw] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionLite[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tier, setTier] = useState<Tier>("free");
  const [pricingModel, setPricingModel] = useState<PricingModel>("flat");
  const [flatFee, setFlatFee] = useState("25");
  const [cpm, setCpm] = useState("4.50");
  const [budgetCap, setBudgetCap] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ id: string; kind: Kind; tier: Tier; attribution_text: string; attribution_url: string; disclosure: unknown } | null>(null);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [subsScope] = useState(() => createRequestScope());

  const walletMatches = !!address && !!walletAddress && address.toLowerCase() === walletAddress.toLowerCase();

  const agreement = useMemo(() => agreementFor("supplier"), []);
  const tags = useMemo(() => tagsRaw.split(",").map((s) => s.trim()).filter(Boolean), [tagsRaw]);
  const images = useMemo(() => imagesRaw.split("\n").map((s) => s.trim()).filter(Boolean), [imagesRaw]);
  const imagePreview = useMemo(() => images.map(mediaHref).find(Boolean) ?? null, [images]);
  const selectedSubmission = useMemo(
    () => submissions.find((s) => s.id === submissionId) ?? null,
    [submissions, submissionId],
  );

  const attributionPreview = useMemo(() => {
    const t = title.trim() || "Your title";
    const who = supplierName.trim() || "Your name";
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 4).join("-") || "untitled";
    const url = `https://versions.persidian.com/listings/preview-${slug}`;
    const noun = kind === "music" ? "Music" : "Featured";
    const base = `${noun}: ${t} by ${who} — via VERSIONS ${url}`;
    if (tier === "paid") return `${base} #ad — Sponsored placement arranged through VERSIONS.`;
    return base;
  }, [title, supplierName, kind, tier]);

  const fetchSubmissions = useCallback(() => {
    if (!walletAddress) return;
    const { signal, isCurrent } = subsScope.start();
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/artists/${walletAddress}/versions?limit=12`,
          { credentials: "same-origin", signal },
        );
        if (!res.ok) {
          if (isCurrent()) setSubmissionsError("Could not load your uploads — retry to pick an existing track.");
          return;
        }
        const json = (await res.json()) as { data?: { rows?: SubmissionLite[] } };
        if (!isCurrent()) return;
        setSubmissionsError(null);
        setSubmissions((prev) => {
          const merged = new Map<string, SubmissionLite>();
          for (const s of json.data?.rows ?? []) merged.set(s.id, s);
          for (const s of prev) if (!merged.has(s.id)) merged.set(s.id, s);
          return [...merged.values()];
        });
      } catch {
        if (signal.aborted) {
          // best effort
        } else if (isCurrent()) {
          setSubmissionsError("Could not load your uploads — retry to pick an existing track.");
        }
      }
    })();
  }, [walletAddress, subsScope]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchSubmissions();
    }, 0);
    return () => {
      window.clearTimeout(t);
      subsScope.cancel();
    };
  }, [fetchSubmissions, subsScope]);

  const onUploaded = useCallback(
    (submission: { id: string; title: string; artistName: string }) => {
      setSubmissionId(submission.id);
      setSubmissions((prev) =>
        prev.some((s) => s.id === submission.id)
          ? prev
          : [...prev, { ...submission, audioPath: "" }],
      );
      if (!title.trim()) setTitle(submission.title);
      if (!supplierName.trim()) setSupplierName(submission.artistName);
      setUploadOpen(false);
      void fetchSubmissions();
      showToast("Upload selected for this listing.", "success", 3000);
    },
    [title, supplierName, fetchSubmissions, showToast],
  );

  const submit = useCallback(async () => {
    setFormError(null);
    if (!agree) { setFormError("Accept the blanket agreement to create a listing."); return; }
    if (title.trim().length < 1 || supplierName.trim().length < 1) { setFormError("Add a title and artist/brand name."); return; }
    const tagList = tagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length === 0) { setFormError("Add at least one tag."); return; }
    if (kind === "music" && !submissionId) { setFormError("Pick a track for this music listing."); return; }
    if (kind === "placement") {
      const raw = imagesRaw.split("\n").map((s) => s.trim()).filter(Boolean);
      if (raw.length === 0) { setFormError("Add at least one image URL for a placement."); return; }
      if (raw.some((u) => !mediaHref(u))) { setFormError("Every image URL must be https:// or ipfs:// — remove or fix invalid entries."); return; }
    }

    setSubmitting(true);
    try {
      const pricing = tier === "free" ? null : pricingModel === "flat" ? { model: "flat" as const, flatFeeUsdc: flatFee } : { model: "cpm" as const, cpmUsdc: cpm };
      const body: Record<string, unknown> = {
        kind,
        title: title.trim(),
        supplierName: supplierName.trim(),
        summary: summary.trim() || null,
        tags: tagList,
        images: kind === "placement" ? images : undefined,
        submissionId: kind === "music" ? submissionId : null,
        tier,
        pricing,
        budgetCapUsdc: tier === "paid" ? budgetCap.trim() || null : null,
        agreementVersion: AGREEMENT_VERSION,
      };
      const data = await marketplaceRequest<{ listing: { id: string; attribution_text: string; attribution_url: string; disclosure: unknown } }>(
        "/api/v1/listings",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      setLastCreated({ id: data.listing.id, kind, tier, attribution_text: data.listing.attribution_text, attribution_url: data.listing.attribution_url, disclosure: data.listing.disclosure });
      track("supply_created", { kind, tier, model: tier === "paid" ? pricingModel : "free" });
      showToast(`${kind === "music" ? "Track" : "Placement"} listed — live in Browse.`, "success", 4000);
      // keep title/tags for batch listing; clear only the one-shot bits
      setBudgetCap("");
      onCreated?.();
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  }, [agree, title, supplierName, summary, tagsRaw, images, kind, submissionId, tier, pricingModel, flatFee, cpm, budgetCap, showToast, imagesRaw, onCreated]);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Create supply">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Create supply</p>
          <h3 className="mt-1 font-serif text-xl font-black tracking-tight">List a track or a product.</h3>
          <p className="mt-1 max-w-xl font-serif text-sm leading-snug text-[var(--color-ink-2)]">
            Goes live immediately under one blanket agreement and is matched against channel ethos. {agreement.title} {AGREEMENT_VERSION}.
          </p>
        </div>
      </div>

      {!isAuthed ? (
        <div className="mt-4">
          <p className="font-serif text-[14px] text-[var(--color-ink-2)]">Sign in to create a listing.</p>
          <div className="mt-2"><WagmiConnectButton variant="quiet" /></div>
        </div>
      ) : (
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="flex rounded-full border border-[var(--color-hair)] p-1 sm:col-span-2 sm:w-fit" role="group" aria-label="Listing kind">
            {(["music", "placement"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  "min-h-[40px] rounded-full px-4 font-mono text-[12px] uppercase tracking-wide",
                  kind === k
                    ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                    : "text-[var(--color-ink-2)] hover:text-[var(--color-rust)]",
                )}
              >
                {k === "music" ? "Music" : "Product placement"}
              </button>
            ))}
          </div>

          <label className="grid gap-1">
            <span className="marketplace-label">{kind === "music" ? "Track title" : "Product name"}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "music" ? "e.g. Nightdrive (lo-fi mix)" : "e.g. Coldbrew subscription"} className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]" />
          </label>
          <label className="grid gap-1">
            <span className="marketplace-label">{kind === "music" ? "Artist name" : "Brand name"}</span>
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder={kind === "music" ? "e.g. Seeder" : "e.g. Coldbrew Co"} className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]" />
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className="marketplace-label">Short pitch / description</span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder={kind === "music" ? "One-line vibe for channel matching…" : "What this product is, in one line…"} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]" />
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className="marketplace-label">Tags (comma-separated) — what a channel matches against</span>
            <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="lo-fi, focus, instrumental" className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]" />
            {tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {tags.slice(0, 12).map((t) => (
                  <span key={t} className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-ink-2)]">{t}</span>
                ))}
              </span>
            )}
          </label>

          {kind === "music" ? (
            <div className="grid gap-2 sm:col-span-2">
              <label className="grid gap-1">
                <span className="marketplace-label">Track (from your uploads)</span>
                <select value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]">
                  <option value="">{submissions.length ? "Pick a track…" : "No uploads yet — upload below"}</option>
                  {submissions.map((s) => (
                    <option key={s.id} value={s.id}>{s.title} · {s.artistName}</option>
                  ))}
                </select>
                <span className="font-mono text-[11px] text-[var(--color-ink-3)]">Reuses the upload pipeline (audio, cover, features). You must own the track.</span>
                {submissionsError && (
                  <span className="flex flex-wrap items-center gap-2">
                    <span role="alert" className="font-serif text-[13px] text-[var(--color-rust)]">{submissionsError}</span>
                    <button type="button" onClick={fetchSubmissions} className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-rust)] underline">
                      Retry
                    </button>
                  </span>
                )}
              </label>
              <p className="font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                New audio uploads use the existing paid review pipeline. Creating a listing from an existing upload has no additional submission fee.
              </p>
              <details open={uploadOpen} className="rounded-[var(--radius-md)] border border-[var(--color-hair)]">
                <summary
                  className="cursor-pointer px-3 py-2 font-mono text-[12px] uppercase tracking-wide text-[var(--color-ink-2)] hover:text-[var(--color-rust)]"
                  onClick={(e) => {
                    e.preventDefault();
                    setUploadOpen((v) => !v);
                  }}
                >
                  Upload a new track · 0.50 USDC
                </summary>
                <div className="border-t border-[var(--color-hair)] p-3">
                  {walletMatches ? (
                    <SubmitForm onUploaded={onUploaded} />
                  ) : (
                    <div>
                      <p className="font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                        Connect the signed-in wallet to upload a new track — the upload fee is paid by
                        the wallet you&apos;re signed in as.
                      </p>
                      <div className="mt-2">
                        <WagmiConnectButton variant="quiet" />
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
          ) : (
            <div className="grid gap-2 sm:col-span-2">
              <label className="grid gap-1">
                <span className="marketplace-label">Images — one URL per line (https:// or ipfs://)</span>
                <textarea value={imagesRaw} onChange={(e) => setImagesRaw(e.target.value)} rows={2} placeholder={"https://example.com/hero.jpg\nipfs://bafy…"} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-xs focus:outline-none focus:border-[var(--color-rust)]" />
              </label>
              {imagePreview && (
                <Image src={imagePreview} alt="Placement preview" width={160} height={112} unoptimized className="h-28 w-auto rounded-[var(--radius-md)] border border-[var(--color-hair)] object-cover" />
              )}
            </div>
          )}

          <div className="sm:col-span-2 grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-hair)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="marketplace-label">Tier</span>
              <button type="button" onClick={() => setTier("free")} aria-pressed={tier === "free"} className={cn("min-h-[40px] rounded-full px-4 font-mono text-[12px] uppercase tracking-wide", tier === "free" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "border border-[var(--color-hair)] text-[var(--color-ink-2)]")}>Free · with credit</button>
              <button type="button" onClick={() => setTier("paid")} aria-pressed={tier === "paid"} className={cn("min-h-[40px] rounded-full px-4 font-mono text-[12px] uppercase tracking-wide", tier === "paid" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "border border-[var(--color-hair)] text-[var(--color-ink-2)]")}>Paid · placement</button>
            </div>
            {tier === "paid" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1">
                  <span className="marketplace-label">Model</span>
                  <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as PricingModel)} className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]">
                    <option value="flat">Flat fee</option>
                    <option value="cpm">CPM</option>
                  </select>
                </label>
                {pricingModel === "flat" ? (
                  <label className="grid gap-1">
                    <span className="marketplace-label">Flat fee (USDC)</span>
                    <input value={flatFee} onChange={(e) => setFlatFee(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]" />
                  </label>
                ) : (
                  <label className="grid gap-1">
                    <span className="marketplace-label">CPM per 1k (USDC)</span>
                    <input value={cpm} onChange={(e) => setCpm(e.target.value)} inputMode="decimal" className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]" />
                  </label>
                )}
                <label className="grid gap-1">
                  <span className="marketplace-label">Budget cap (USDC, optional)</span>
                  <input value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} placeholder="uncapped" inputMode="decimal" className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-mono text-[13px]" />
                </label>
                <p className="sm:col-span-3 font-serif text-[13px] leading-snug text-[var(--color-ink-2)]">
                  The channel operator pays you for placements. Paid listings carry disclosure and a tracking code automatically; serving stops when the cap is hit.
                </p>
              </div>
            )}
          </div>

          <div className="sm:col-span-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-3">
            <p className="marketplace-label">Attribution preview — sample; the exact text is generated when the listing is saved</p>
            <p className="mt-1.5 font-mono text-xs leading-snug break-words text-[var(--color-ink)]">{attributionPreview}</p>
          </div>

          <details className="sm:col-span-2">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">Blanket agreement ({AGREEMENT_VERSION})</summary>
            <div className="mt-3 space-y-2">
              {agreement.terms.map((t) => (
                <p key={t.slice(0, 40)} className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">• {t}</p>
              ))}
              <p className="font-serif text-sm font-semibold italic text-[var(--color-ink)]">“{agreement.acceptance}”</p>
            </div>
          </details>

          <label className="flex items-start gap-2 sm:col-span-2">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
            <span className="font-mono text-xs leading-snug text-[var(--color-ink-2)]">{agreement.acceptance}</span>
          </label>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="button" onClick={submit} disabled={submitting || !agree} className="btn-primary disabled:opacity-50">
              {submitting ? "Creating…" : kind === "music" ? "List this track" : "List this placement"}
            </button>
            <span className="font-mono text-[11px] text-[var(--color-ink-3)]">Goes live immediately. You can pause it later.</span>
          </div>
          {formError && (
            <p role="alert" className="font-serif text-[14px] text-[var(--color-rust)] sm:col-span-2">{formError}</p>
          )}

          {lastCreated && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-rust)] bg-[var(--color-paper-2)] p-3 sm:col-span-2">
              <p className="marketplace-label">Created · {lastCreated.kind} · {lastCreated.tier}</p>
              <p className="mt-1 break-words font-mono text-xs text-[var(--color-ink-2)]">{lastCreated.attribution_text}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">{lastCreated.attribution_url}</p>
              <Link href={`/listings/${lastCreated.id}`} className="btn-secondary mt-2 inline-block">View listing →</Link>
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <div className="marketplace-kit">
            <p className="marketplace-label">Listing preview</p>
            <div className="mt-3">
              <ListingMedia
                title={title.trim() || (kind === "music" ? "Your track" : "Your product")}
                kind={kind}
                audioPath={kind === "music" ? selectedSubmission?.audioPath ?? null : null}
                coverSvg={kind === "music" ? selectedSubmission?.coverSvg ?? null : null}
                images={kind === "placement" ? images : []}
              />
            </div>
            <p className="mt-3 font-serif text-[15px] font-semibold leading-tight text-[var(--color-ink)]">
              {title.trim() || (kind === "music" ? "Your track" : "Your product")}
            </p>
            <p className="font-serif text-[14px] text-[var(--color-ink-2)]">{supplierName.trim() || "Your name"}</p>
            <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-3)]">
              {tier === "free"
                ? "free · required credit"
                : pricingModel === "flat"
                  ? `paid · flat ${flatFee} USDC`
                  : `paid · CPM ${cpm} USDC`}
            </p>
          </div>
        </aside>
      </div>
      )}
    </section>
  );
}
