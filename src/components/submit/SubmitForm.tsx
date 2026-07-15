"use client";

// MODULAR: Submit form — the artist-facing flow. Multi-step state
// machine with explicit phases (idle / submitting / pending / verifying /
// verified / failed / abandoned) that drive the UI. Encapsulated in
// one component; the page renders it directly.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Dropzone } from "@/components/submit/Dropzone";
import { useToast } from "@/components/ui/Toast";
import { Tour } from "@/components/ui/Tour";
import { ApiError, apiClient, type AgentReviewRecord } from "@/lib/api-client";
import { copyToClipboard } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { useSubmitPayment, type PaymentPhase, type SendPaymentResult } from "@/components/submit/use-submit-payment";

const PAYMENT_RETRIES = 3;
const FEE_AMOUNT_USDC = "0.50";

type SubmitPhase =
  | { phase: "idle" }
  | { phase: "submitting"; message?: string }
  | { phase: "pending"; submissionId: string }
  | { phase: "verifying"; submissionId: string; message?: string }
  | { phase: "verified"; submissionId: string }
  | { phase: "failed"; submissionId: string; attempts: number; message?: string }
  | { phase: "abandoned"; submissionId: string; attempts: number };

type ReviewItem = AgentReviewRecord;

const AGENT_LABELS: Record<string, { icon: string; name: string }> = {
  production: { icon: "🎛️", name: "Production Agent" },
  performance: { icon: "🎤", name: "Performance Agent" },
  market: { icon: "📊", name: "Market Agent" },
};

const ENERGY_LABELS: Record<string, string> = { lower: "LOWER", same: "SAME", higher: "HIGHER" };
const TEMPO_LABELS: Record<string, string> = { dragging: "DRAGGING", locked: "LOCKED", rushing: "RUSHING" };

// MODULAR: extract the last in-flight tx hash from any hook
// phase that legally carries one. Used by retryVerifyPayment to
// avoid burning fresh user funds on receipt-timeout retries —
// the original tx is on-chain; Arc RPC just hasn't caught up
// yet. The shim sets lastTxHash.current on success only, so
// when the receipt timeout throws we need a second source of
// truth. The hook's error phase carries the broadcast hash
// (added precisely for this fallback) and the broadcasting phase
// is covered defensively in case the deadline happens to fire
// before the receipt watcher resolves.
// MODULAR: TS narrowing works here because each branch's `phase`
// discriminant narrows the union before we read .txHash — no
// `as` cast required.
function paymentRecoveredTxHash(phase: PaymentPhase): string | null {
  if (phase.phase === "broadcasting") return phase.txHash;
  if (phase.phase === "error" && phase.txHash) return phase.txHash;
  return null;
}

export function SubmitForm() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { showToast } = useToast();
  // MODULAR: destructure the hook so the `sendPayment` reference
  // is stable across renders (the hook's returned object itself is
  // fresh each render, but `sendPayment` is wrapped in useCallback
  // and is the only field the submit state machine actually depends
  // on). Destructuring keeps the form's onSubmit / retry deps stable.
  // MODULAR: `phase` is pulled out for the chain-status banner
  // — `arcInfo` is owned by the hook and queried on demand, the
  // form doesn't need it anymore (mocked flag comes from
  // sendPayment's return value, not the cached ArcInfo).
  const { sendPayment, phase: paymentPhase, reset: resetPayment } = useSubmitPayment({
    feeAmountUsdc: FEE_AMOUNT_USDC,
  });
  // MODULAR: cache the tx hash so the success-path message shows
  // the user the actual on-chain receipt, not just "submitted".
  const lastTxHash = useRef<string | null>(null);

  const [state, setState] = useState<SubmitPhase>({ phase: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [coverSvg, setCoverSvg] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("");

  // MODULAR: fire form_start once when the user first focuses any
  // field in the form. This lets us measure form abandonment vs.
  // submit conversion separately — users who land on /submit but
  // never focus a field are a different drop-off cohort than users
  // who start filling the form but bail before submit.
  const formStarted = useRef(false);
  const onFormFocus = useCallback(() => {
    if (formStarted.current) return;
    formStarted.current = true;
    track("form_start", { field: "title" });
  }, []);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setFile(null);
    setCoverSvg(null);
    setReviews(null);
    setReviewStatus("");
    formStarted.current = false;
    lastTxHash.current = null;
    // MODULAR: also reset the payment hook so a fresh submit
    // doesn't inherit the previous attempt's last phase (e.g.
    // showing a stale "Awaiting wallet sign…" banner on a brand
    // new form).
    resetPayment();
    const form = document.getElementById("submitForm") as HTMLFormElement | null;
    form?.reset();
  }, [resetPayment]);

  // ──────────────────────────────────────────────────────────
  // Polling for AI agent reviews after verification
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (state.phase !== "verified") return;
    let cancelled = false;
    const submissionId = state.submissionId;
    setReviewStatus("AI agents analyzing track…");
    /* eslint-enable react-hooks/set-state-in-effect */
    const deadline = Date.now() + 30_000;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setReviewStatus("Review still in progress. Check back shortly.");
        return;
      }
      try {
        const data = await apiClient.getReviews(submissionId);
        if (cancelled) return;
        if (Array.isArray(data) && data.length >= 3) {
          setReviews(data);
          setReviewStatus("");
          return;
        }
        setReviewStatus(`${data?.length ?? 0}/3 agents finished reviewing…`);
      } catch {
        /* retry */
      }
      setTimeout(tick, 1_500);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [state]);

  // ──────────────────────────────────────────────────────────
  // Payment helpers
  // ──────────────────────────────────────────────────────────
  // MODULAR: getPaymentTxHash is a thin shim over the
  // useSubmitPayment hook so the existing state-machine code in
  // onSubmit / retryVerifyPayment reads identically. Forwards
  // the hook's SendPaymentResult verbatim and caches the
  // txHash on a ref so the success/ban paths can show the
  // on-chain receipt. Returning the typed SendPaymentResult
  // (not an inline shape) keeps this shim in lockstep with the
  // hook — adding a field upstream won't silently drop it
  // here.
  const getPaymentTxHash = useCallback(async (): Promise<SendPaymentResult> => {
    const result = await sendPayment();
    lastTxHash.current = result.txHash;
    return result;
  }, [sendPayment]);

  const retryVerifyPayment = useCallback(
    async (s: { submissionId: string; attempts: number }) => {
      setState({ phase: "verifying", submissionId: s.submissionId, message: "Re-attempting payment verification…" });
      // MODULAR: retry-first verifies with the cached tx hash
      // from the previous attempt. Re-sending a brand new tx
      // every retry burns gas on the user (in real mode) and
      // produces extra on-chain noise if the original tx was
      // valid but slow to propagate to Arc RPC.
      //
      // Cache lookup chain (in priority order):
      //   1. lastTxHash.current — set by the shim on the SUCCESS
      //      path. Catches the "verifyPayment itself failed" case
      //      (txHash broadcast + receipt confirmed + verify
      //      endpoint returned non-awaiting_curation).
      //   2. paymentPhase.txHash — catches cases where:
      //      (a) writeContractAsync succeeded but the receipt
      //          wait timed out. The hook sets phase="error"
      //          WITH txHash, so we re-verify the same hash —
      //          the server will eventually see it.
      //      (b) writeContractAsync succeeded and we're still
      //          in the broadcasting-waiting-for-receipt phase
      //          (defensive — this branch shouldn't fire in
      //          practice because submit can't fail mid-receipt
      //          wait, but covered for safety).
      //   3. null — fall through to a fresh getPaymentTxHash
      //      (first attempt failed before broadcast, e.g.
      //      switchChain rejected, writeContract rejected,
      //      getArcInfo network error, runtime chainId guard).
      let txHash: string | null =
        lastTxHash.current ?? paymentRecoveredTxHash(paymentPhase);
      track("payment_tx_retry", { submissionId: s.submissionId, attempt: s.attempts, hasCachedHash: !!txHash });
      if (!txHash) {
        try {
          const fresh = await getPaymentTxHash();
          txHash = fresh.txHash;
        } catch {
          // surface this without bumping attempts so the user can try the cached-hash path again
          setState({
            phase: "failed",
            submissionId: s.submissionId,
            attempts: s.attempts,
            message: "Retry couldn't send a fresh tx — try again.",
          });
          showToast("Couldn't send a fresh tx. Try again.", "warning", 4000);
          return;
        }
      }
      try {
        const verify = await apiClient.verifyPayment(s.submissionId, { txHash });
        if (verify.status !== "awaiting_curation") {
          throw new Error(`Verification returned status=${verify.status}`);
        }
        setState({ phase: "verified", submissionId: s.submissionId });
        // MODULAR: same rationale as onSubmit — the funnel
        // (src/services/telemetry.ts + /api/v1/funnel) uses
        // payment_verified as the funnel step; duplicating to a
        // payment_tx_confirmed event would double-count.
        track("payment_verified", { submissionId: s.submissionId, txHash });
        showToast("Payment verified — submission is in the curator queue.", "success", 5000);
      } catch (err) {
        const attempts = s.attempts + 1;
        if (attempts >= PAYMENT_RETRIES) {
          setState({ phase: "abandoned", submissionId: s.submissionId, attempts });
          showToast(`Payment failed after ${attempts} attempts.`, "error", 5000);
        } else {
          setState({
            phase: "failed",
            submissionId: s.submissionId,
            attempts,
            message: `Payment attempt ${attempts} failed: ${(err as Error).message}`,
          });
          showToast(`Payment attempt ${attempts} failed. Try again.`, "warning", 4000);
        }
      }
    },
    [getPaymentTxHash, paymentPhase, showToast],
  );

  // ──────────────────────────────────────────────────────────
  // Submit handler
  // ──────────────────────────────────────────────────────────
  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!isConnected || !address) {
        showToast("Connect your wallet first.", "warning");
        return;
      }
      if (!file) {
        showToast("Pick an audio file.", "warning");
        return;
      }
      const form = e.currentTarget;
      const fd = new FormData(form);
      track("submit_attempt");
      setState({ phase: "submitting", message: "Signing submission…" });

      try {
        const message = "VERSIONS_LEPTON_SUBMIT";
        const signature = await signMessageAsync({ message });

        const mbid = ((fd.get("musicbrainz_id") as string) || "").trim() || null;
        const metadata = {
          title: fd.get("title"),
          artistName: fd.get("artistName"),
          versionType: fd.get("versionType"),
          genre: fd.get("genre") || null,
          mood: fd.get("mood") || null,
          description: fd.get("description") || null,
          musicbrainzId: mbid,
          coverSvg,
        };

        const fd2 = new FormData();
        fd2.set("signature", signature);
        fd2.set("artistWallet", address);
        fd2.set("metadata", JSON.stringify(metadata));
        fd2.set("audio", file, file.name || "audio.wav");

        setState({ phase: "submitting", message: "Uploading audio…" });
        const data = await apiClient.createSubmission(fd2);
        const submissionId = data.id;

        setState({ phase: "pending", submissionId });
        track("payment_initiated", { submissionId });
        const { txHash, mocked: wasMockedPayment, chainId: paymentChainId, mockReason } = await getPaymentTxHash();
        // MODULAR: payment_tx_broadcast captures the moment the
        // tx is sent (or a DEV mock replaces it). The mocked
        // flag + chainId + mockReason came directly from the
        // hook's response so we don't have to inspect
        // paymentPhase inside this closure (which would read the
        // stale pre-send snapshot due to React state batching).
        // Mock sends report chainId: null + mockReason set so
        // the funnel can tell "no on-chain settlement" apart
        // from "settled on chain X", and an ops dashboard can
        // split "deliberate preview deploy" from "operator env
        // misconfig".
        track("payment_tx_broadcast", {
          submissionId,
          txHash,
          mocked: wasMockedPayment,
          chainId: paymentChainId,
          mockReason,
        });
        setState({ phase: "verifying", submissionId, message: "Awaiting finality…" });
        const verify = await apiClient.verifyPayment(submissionId, { txHash });
        if (verify.status !== "awaiting_curation") {
          throw new Error(`Verification returned status=${verify.status}`);
        }
        setState({ phase: "verified", submissionId });
        track("submit_success", { submissionId });
        // MODULAR: payment_verified is the existing funnel step
        // (see src/services/telemetry.ts #FUNNEL_STEPS and the
        // /api/v1/funnel endpoint). We deliberately don't add a
        // separate "payment_tx_confirmed" event — it fires from
        // the same trigger (verifyPayment returning
        // awaiting_curation) and would double-count in the funnel
        // query. payment_tx_broadcast + payment_verified gives
        // the meaningful split: "tx sent" vs "server confirmed".
        track("payment_verified", { submissionId, txHash });
        // MODULAR: surface the actual on-chain tx hash in the
        // success toast so the user has a copy-pasteable receipt
        // for support / tax / a-r-i claims. Truncated to the
        // first 10 hex chars + … — full hash is on the verify API
        // response and the explorer link in the toast.
        const txShort = txHash ? `${txHash.slice(0, 10)}…` : "";
        showToast(
          wasMockedPayment
            ? `Submission live in the queue (DEV-ONLY mock tx ${txShort}).`
            : `Submission live in the queue — tx ${txShort}`,
          "success",
          6000,
        );
        form.reset();
        setFile(null);
        setCoverSvg(null);
        formStarted.current = false;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const submissionId =
          err instanceof ApiError && err.body && typeof err.body === "object" && "data" in err.body
            ? ((err.body as { data?: { id?: string } }).data?.id ?? null)
            : null;
        track("submit_failed", { hasSubmissionId: !!submissionId, error: msg.slice(0, 120) });
        if (submissionId) {
          setState({ phase: "failed", submissionId, attempts: 1, message: msg });
        } else {
          setState({ phase: "idle" });
          showToast(`Submit failed: ${msg}`, "error", 6000);
        }
      }
    },
    [address, coverSvg, file, getPaymentTxHash, isConnected, showToast, signMessageAsync],
  );

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────
  const submitDisabled = state.phase !== "idle" && state.phase !== "failed";
  const submitLabel =
    state.phase === "submitting"
      ? "Submitting…"
      : state.phase === "pending" || state.phase === "verifying"
      ? "Verifying payment…"
      : state.phase === "verified"
      ? "Submitted"
      : "Submit for 0.50 USDC";

  const statusMessage =
    state.phase === "submitting"
      ? state.message || "Working…"
      : state.phase === "pending"
      ? `Submission ${state.submissionId.slice(0, 8)}… created. Verifying payment…`
      : state.phase === "verifying"
      ? state.message || "Awaiting payment confirmation…"
      : state.phase === "verified"
      ? "Submission live. AI agents reviewing…"
      : state.phase === "failed"
      ? state.message || "Submission saved — payment not yet verified."
      : state.phase === "abandoned"
      ? `Submission abandoned after ${state.attempts} failed attempts.`
      : "";

  return (
    <>
      <form id="submitForm" onSubmit={onSubmit} className="space-y-6" noValidate>
        <div className="grid md:grid-cols-2 gap-6">
          <label className="block md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Title
            </span>
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Gravity — acoustic demo, 3am take"
              onFocus={onFormFocus}
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Artist name
            </span>
            <input
              name="artistName"
              required
              maxLength={100}
              placeholder="Your name or alias"
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Version type
            </span>
            <select
              name="versionType"
              required
              defaultValue="demo"
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
            >
              <option value="demo">Demo</option>
              <option value="live">Live</option>
              <option value="acoustic">Acoustic</option>
              <option value="remix">Remix</option>
              <option value="remaster">Remaster</option>
              <option value="studio">Studio</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Genre
            </span>
            <input
              name="genre"
              maxLength={50}
              placeholder="Folk · Soul · Indie"
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Mood
            </span>
            <input
              name="mood"
              maxLength={100}
              placeholder="Intimate · Raw · Euphoric"
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              MusicBrainz ID <span className="normal-case tracking-normal text-[var(--color-ink-3)]">(optional)</span>
            </span>
            <input
              name="musicbrainz_id"
              maxLength={36}
              placeholder="e.g. 1b8df96b-4d61-4a76-aa70-0c5c0d6e9b3a"
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Description
            </span>
            <textarea
              name="description"
              maxLength={1000}
              rows={3}
              placeholder="Recorded in a bedroom, 3am. Mics are warm."
              className="w-full bg-transparent border-b-2 border-[var(--color-hair-strong)] focus:border-[var(--color-rust)] focus:outline-none py-3 font-serif text-lg resize-none"
            />
          </label>
          <div className="block md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] block mb-2">
              Audio file
            </span>
            <Dropzone
              onFile={(f, meta) => {
                setFile(f);
                setCoverSvg(meta.coverSvg);
              }}
            />
          </div>
        </div>

        <div className="pt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
              Total cost: <strong className="text-[var(--color-ink)]">0.50 USDC</strong> · settled on Arc
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              No additional gas or hidden fees
            </p>
          </div>
          <button
            type="submit"
            disabled={submitDisabled}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-8 py-4 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitLabel} →
          </button>
        </div>

        {statusMessage && (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
            {statusMessage}
          </p>
        )}

        {paymentPhase.phase !== "idle" && paymentPhase.phase !== "error" && (
          // MODULAR: chain-status banner — surfaces what the
          // payment hook is doing in real time so the user isn't
          // staring at a spinner wondering whether they're being
          // prompted to switch chains, sign in the wallet, or
          // waiting for finality. Two visual flavors:
          //   - mock + non-broadcast: yellow-tinted DEV-ONLY warning
          //     so a preview deploy is never confused with prod.
          //   - real + non-broadcast: neutral italic micro-status.
          <div
            className={
              paymentPhase.phase === "mocked"
                ? "border-l-2 border-[var(--color-rust)] bg-[var(--color-paper-2)]/60 pl-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] flex items-start gap-2"
                : "border-l-2 border-[var(--color-hair-strong)] bg-[var(--color-paper-2)]/60 pl-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] flex items-start gap-2"
            }
            aria-live="polite"
          >
            <span className="shrink-0">
              {paymentPhase.phase === "mocked"
                ? "⚠"
                : paymentPhase.phase === "switching_chain"
                ? "↻"
                : paymentPhase.phase === "awaiting_wallet_sign"
                ? "→"
                : paymentPhase.phase === "broadcasting"
                ? "✓"
                : "•"}
            </span>
            <span className="flex-1">
              {paymentPhase.phase === "mocked" &&
                (paymentPhase.reason === "arc-mock"
                  ? "DEV-ONLY mock payment — connect ARC_RPC_URL, ARC_USDC_CONTRACT and PLATFORM_WALLET to settle on Arc."
                  : "Arc config incomplete — falling back to DEV mock. Set ARC_RPC_URL + ARC_USDC_CONTRACT + PLATFORM_WALLET in env.")}
              {paymentPhase.phase === "switching_chain" &&
                `Switching to Arc testnet (chain ${paymentPhase.targetChainId}) — approve in your wallet.`}
              {paymentPhase.phase === "awaiting_wallet_sign" &&
                "Approve the 0.50 USDC transfer in your wallet."}
              {paymentPhase.phase === "broadcasting" &&
                // MODULAR: the `broadcasting` phase now covers both
                // the post-writeContract state AND the 1-confirmation
                // wait. Surface the wait explicitly so the user
                // doesn't think the spinner is hung and click again
                // (which would queue a duplicate tx on the wallet).
                `Confirming on Arc (waiting 1 block confirmation) — tx ${paymentPhase.txHash.slice(0, 10)}…`}
            </span>
          </div>
        )}

        {state.phase === "failed" && (
          <div className="border border-[var(--color-rust)] bg-[var(--color-paper-2)] p-4 flex flex-col gap-3">
            <div className="font-serif text-sm">
              <strong className="text-[var(--color-rust)] font-medium block mb-1">
                Payment verification failed.
              </strong>
              <span className="text-[var(--color-ink-2)]">
                {state.attempts} of {PAYMENT_RETRIES} attempts. The submission is saved (id{" "}
                <code className="font-mono text-xs bg-[var(--color-paper)] px-1.5 py-0.5 border border-[var(--color-hair-strong)]">
                  {state.submissionId.slice(0, 8)}…
                </code>
                ); only the payment needs to settle.
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => retryVerifyPayment(state)}
                className="font-mono text-[11px] uppercase tracking-[0.18em] border border-[var(--color-ink)] px-4 py-2 hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-colors"
              >
                Retry payment verification
              </button>
              <button
                type="button"
                onClick={reset}
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] hover:text-[var(--color-rust)]"
              >
                Start a new submission
              </button>
            </div>
          </div>
        )}

        {state.phase === "abandoned" && (
          <div className="border border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] p-4 flex flex-col gap-3">
            <div className="font-serif text-sm">
              <strong className="font-medium block mb-1">This submission has been abandoned.</strong>
              <span className="text-[var(--color-ink-2)]">
                The audio is still on the server but it will not publish. Start a new submission below.
              </span>
            </div>
            <button
              type="button"
              onClick={reset}
              className="font-mono text-[11px] uppercase tracking-[0.18em] border border-[var(--color-ink)] px-4 py-2 self-start hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-colors"
            >
              Start a new submission
            </button>
          </div>
        )}

        {state.phase === "verified" && (
          <div className="border border-[var(--color-hair-strong)] p-4 flex flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
              Agent reviews
            </div>
            {reviewStatus && (
              <div className="font-mono text-xs text-[var(--color-ink-2)]">{reviewStatus}</div>
            )}
            {reviews && reviews.length > 0 && (
              <div className="flex flex-col gap-3">
                {reviews.map((r, idx) => {
                  const agent = AGENT_LABELS[r.agent_name] ?? { icon: "🤖", name: r.agent_name };
                  return (
                    <div
                      key={idx}
                      className="border-t border-[var(--color-hair)] pt-3"
                      style={{ animationDelay: `${idx * 0.15}s` }}
                    >
                      <div className="font-mono text-xs mb-1 flex items-center gap-2">
                        <span>{agent.icon}</span>
                        <strong>{agent.name}</strong>
                      </div>
                      <div className="font-mono text-xs text-[var(--color-ink-2)] flex flex-wrap gap-x-4">
                        <span>
                          Solo <strong className="text-[var(--color-ink)]">{r.solo_intensity}</strong>/10
                        </span>
                        <span>
                          Vocal <strong className="text-[var(--color-ink)]">{r.vocal_quality}</strong>/10
                        </span>
                        <span>
                          Energy <strong className="text-[var(--color-ink)]">{ENERGY_LABELS[r.energy_vs_studio] ?? r.energy_vs_studio}</strong>
                        </span>
                        <span>
                          Tempo <strong className="text-[var(--color-ink)]">{TEMPO_LABELS[r.tempo_feel] ?? r.tempo_feel}</strong>
                        </span>
                      </div>
                      {r.notes && (
                        <p className="font-serif text-sm text-[var(--color-ink-2)] mt-2">{r.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </form>

      <Tour autoStart withTrigger />
    </>
  );
}
