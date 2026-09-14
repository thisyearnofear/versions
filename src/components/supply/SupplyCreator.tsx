"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { agreementFor, AGREEMENT_VERSION } from "@/lib/agreement";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type Kind = "music" | "placement";
type Tier = "free" | "paid";
type PricingModel = "flat" | "cpm";

interface SubmissionLite { id: string; title: string; artistName: string; audioPath: string }

function formatError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function SupplyCreator() {
  const { address } = useAccount();
  const { showToast } = useToast();

  const [kind, setKind] = useState<Kind>("music");
  const [title, setTitle] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [summary, setSummary] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [imagesRaw, setImagesRaw] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionLite[]>([]);
  const [tier, setTier] = useState<Tier>("free");
  const [pricingModel, setPricingModel] = useState<PricingModel>("flat");
  const [flatFee, setFlatFee] = useState("25");
  const [cpm, setCpm] = useState("4.50");
  const [budgetCap, setBudgetCap] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ id: string; kind: Kind; tier: Tier; attribution_text: string; attribution_url: string; disclosure: unknown } | null>(null);

  const agreement = useMemo(() => agreementFor("supplier"), []);
  const tags = useMemo(() => tagsRaw.split(",").map((s) => s.trim()).filter(Boolean), [tagsRaw]);
  const images = useMemo(() => imagesRaw.split("\n").map((s) => s.trim()).filter(Boolean), [imagesRaw]);

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

  const fetchSubmissions = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/v1/artists/${address}/versions?limit=12`, { credentials: "same-origin" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { rows?: SubmissionLite[] } };
      setSubmissions(json.data?.rows ?? []);
      if (!submissionId && json.data?.rows?.[0]) setSubmissionId(json.data.rows[0].id);
    } catch {
      // best effort
    }
  }, [address, submissionId]);

  useEffect(() => { void fetchSubmissions(); }, [fetchSubmissions]);

  const submit = useCallback(async () => {
    if (!agree) { showToast("Accept the blanket agreement to create a listing.", "warning"); return; }
    if (title.trim().length < 1 || supplierName.trim().length < 1) { showToast("Add a title and artist/brand name.", "warning"); return; }
    const tagList = tagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length === 0) { showToast("Add at least one tag.", "warning"); return; }
    if (kind === "music" && !submissionId) { showToast("Pick a track for this music listing.", "warning"); return; }
    if (kind === "placement" && imagesRaw.split("\n").map((s) => s.trim()).filter(Boolean).length === 0) { showToast("Add at least one image URL for a placement.", "warning"); return; }

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
        budgetCapUsdc: budgetCap.trim() || null,
        agreementVersion: AGREEMENT_VERSION,
      };
      const res = await fetch("/api/v1/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const json = (await res.json()) as { success: boolean; error?: { message: string }; data?: { listing: { id: string; attribution_text: string; attribution_url: string; disclosure: unknown } } };
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setLastCreated({ id: json.data!.listing.id, kind, tier, attribution_text: json.data!.listing.attribution_text, attribution_url: json.data!.listing.attribution_url, disclosure: json.data!.listing.disclosure });
      track("supply_created", { kind, tier, model: tier === "paid" ? pricingModel : "free" });
      showToast(`${kind === "music" ? "Track" : "Placement"} listed — live in Browse.`, "success", 4000);
      // keep title/tags for batch listing; clear only the one-shot bits
      setBudgetCap("");
    } catch (err) {
      showToast(formatError(err), "error");
    } finally {
      setSubmitting(false);
    }
  }, [agree, title, supplierName, summary, tagsRaw, images, kind, submissionId, tier, pricingModel, flatFee, cpm, budgetCap, showToast, imagesRaw]);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Create supply">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Create supply</p>
          <h3 className="mt-1 font-serif text-xl font-black tracking-tight">One card, two catalogs.</h3>
          <p className="mt-1 max-w-xl font-serif text-sm leading-snug text-[var(--color-ink-2)]">
            No review queue — it goes live and is matched against channel ethos. {agreement.title} {AGREEMENT_VERSION}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setKind((k) => (k === "music" ? "placement" : "music"))}
          className="rounded-full border border-[var(--color-hair-strong)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
        >
          {kind === "music" ? "Music → Placement" : "Placement → Music"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">{kind === "music" ? "Track title" : "Product name"}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "music" ? "e.g. Nightdrive (lo-fi mix)" : "e.g. Coldbrew subscription"} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
        </label>
        <label className="grid gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">{kind === "music" ? "Artist name" : "Brand name"}</span>
          <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder={kind === "music" ? "e.g. Seeder" : "e.g. Coldbrew Co"} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Short pitch / description</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder={kind === "music" ? "One-line vibe for channel matching…" : "What this product is, in one line…"} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Tags (comma-separated) — what a channel matches against</span>
          <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="lo-fi, focus, instrumental" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]" />
          {tags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {tags.slice(0, 12).map((t) => (
                <span key={t} className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">{t}</span>
              ))}
            </span>
          )}
        </label>

        {kind === "music" ? (
          <label className="grid gap-1 sm:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Track (from your uploads)</span>
            <select value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-serif text-sm focus:outline-none focus:border-[var(--color-rust)]">
              <option value="">{submissions.length ? "Pick a track…" : "No uploads yet — upload below"}</option>
              {submissions.map((s) => (
                <option key={s.id} value={s.id}>{s.title} · {s.id.slice(0, 8)}</option>
              ))}
            </select>
            <span className="font-mono text-[10px] text-[var(--color-ink-3)]">Reuses the upload pipeline (audio, cover, features). You must own the track.</span>
          </label>
        ) : (
          <label className="grid gap-1 sm:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Images — one URL per line (ipfs:// or https://)</span>
            <textarea value={imagesRaw} onChange={(e) => setImagesRaw(e.target.value)} rows={2} placeholder={"ipfs://brew-1.png\nhttps://example.com/hero.jpg"} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2.5 font-mono text-xs focus:outline-none focus:border-[var(--color-rust)]" />
          </label>
        )}

        <div className="sm:col-span-2 grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-hair)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Tier</span>
            <button type="button" onClick={() => setTier("free")} className={cn("rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide", tier === "free" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "border border-[var(--color-hair)] text-[var(--color-ink-2)]")}>Free · with attribution</button>
            <button type="button" onClick={() => setTier("paid")} className={cn("rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide", tier === "paid" ? "bg-[var(--color-ink)] text-[var(--color-paper)]" : "border border-[var(--color-hair)] text-[var(--color-ink-2)]")}>Paid · sponsor slot</button>
          </div>
          {tier === "paid" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Model</span>
                <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as PricingModel)} className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-xs">
                  <option value="flat">Flat fee</option>
                  <option value="cpm">CPM</option>
                </select>
              </label>
              {pricingModel === "flat" ? (
                <label className="grid gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Flat fee (USDC)</span>
                  <input value={flatFee} onChange={(e) => setFlatFee(e.target.value)} inputMode="decimal" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
                </label>
              ) : (
                <label className="grid gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">CPM per 1k (USDC)</span>
                  <input value={cpm} onChange={(e) => setCpm(e.target.value)} inputMode="decimal" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
                </label>
              )}
              <label className="grid gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Budget cap (USDC, optional)</span>
                <input value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} placeholder="uncapped" inputMode="decimal" className="rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 py-2 font-mono text-sm" />
              </label>
              <p className="sm:col-span-3 font-mono text-[10px] leading-snug text-[var(--color-ink-3)]">
                Paid listings carry disclosure and a tracking code automatically. Serving stops when the cap is hit — a guarded atomic UPDATE.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]">Attribution preview — what a channel must render unmodified</p>
        <p className="mt-1.5 font-mono text-xs leading-snug break-words text-[var(--color-ink)]">{attributionPreview}</p>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">Blanket agreement ({AGREEMENT_VERSION})</summary>
        <div className="mt-3 space-y-2">
          {agreement.terms.map((t) => (
            <p key={t.slice(0, 40)} className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">• {t}</p>
          ))}
          <p className="font-serif text-sm font-semibold italic text-[var(--color-ink)]">“{agreement.acceptance}”</p>
        </div>
      </details>

      <label className="mt-4 flex items-start gap-2">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        <span className="font-mono text-xs leading-snug text-[var(--color-ink-2)]">{agreement.acceptance}</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={submitting || !agree} className="btn-primary disabled:opacity-50">
          {submitting ? "Creating…" : kind === "music" ? "List this track" : "List this placement"}
        </button>
        <span className="font-mono text-[10px] text-[var(--color-ink-3)]">Goes live immediately. You can pause or archive it later.</span>
      </div>

      {lastCreated && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-rust)] bg-[var(--color-paper-2)] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-rust)]">Created · {lastCreated.kind} · {lastCreated.tier} · {lastCreated.id.slice(0, 8)}</p>
          <p className="mt-1 break-words font-mono text-xs text-[var(--color-ink-2)]">{lastCreated.attribution_text}</p>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">{lastCreated.attribution_url}</p>
        </div>
      )}
    </section>
  );
}
