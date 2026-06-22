"use client";

// MODULAR: Submit form — the artist-facing flow. Multi-step state
// machine with explicit phases (idle / submitting / pending / verifying /
// verified / failed / abandoned) that drive the UI. Encapsulated in
// one component; the page renders it directly.

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Dropzone } from "@/components/submit/Dropzone";
import { useToast } from "@/components/ui/Toast";
import { Tour } from "@/components/ui/Tour";
import { ApiError, apiClient, type AgentReviewRecord } from "@/lib/api-client";
import { copyToClipboard } from "@/lib/utils";

const PAYMENT_RETRIES = 3;

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

export function SubmitForm() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { showToast } = useToast();

  const [state, setState] = useState<SubmitPhase>({ phase: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [coverSvg, setCoverSvg] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("");

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setFile(null);
    setCoverSvg(null);
    setReviews(null);
    setReviewStatus("");
    const form = document.getElementById("submitForm") as HTMLFormElement | null;
    form?.reset();
  }, []);

  // ──────────────────────────────────────────────────────────
  // Polling for AI agent reviews after verification
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "verified") return;
    let cancelled = false;
    const submissionId = state.submissionId;
    setReviewStatus("AI agents analyzing track…");
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
  const getPaymentTxHash = useCallback(async (): Promise<string> => {
    try {
      const info = await apiClient.getArcInfo();
      // MODULAR: real EVM transfer is wired in a separate wallet task.
      // Until then, return a deterministic mock tx hash so the rest
      // of the state machine can be exercised end-to-end.
      if (!info.mock && info.usdcContract) {
        // Real sendUsdcTransferViaEvm goes here once the wallet
        // component is wired into the page-level client.
      }
    } catch {
      /* fall back to mock */
    }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }, []);

  const retryVerifyPayment = useCallback(
    async (s: { submissionId: string; attempts: number }) => {
      setState({ phase: "verifying", submissionId: s.submissionId, message: "Re-attempting payment verification…" });
      try {
        const txHash = await getPaymentTxHash();
        const verify = await apiClient.verifyPayment(s.submissionId, { txHash });
        if (verify.status !== "awaiting_curation") {
          throw new Error(`Verification returned status=${verify.status}`);
        }
        setState({ phase: "verified", submissionId: s.submissionId });
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
    [getPaymentTxHash, showToast],
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
        const txHash = await getPaymentTxHash();
        setState({ phase: "verifying", submissionId, message: "Awaiting finality…" });
        const verify = await apiClient.verifyPayment(submissionId, { txHash });
        if (verify.status !== "awaiting_curation") {
          throw new Error(`Verification returned status=${verify.status}`);
        }
        setState({ phase: "verified", submissionId });
        showToast("Submission live in the queue.", "success");
        form.reset();
        setFile(null);
        setCoverSvg(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const submissionId =
          err instanceof ApiError && err.body && typeof err.body === "object" && "data" in err.body
            ? ((err.body as { data?: { id?: string } }).data?.id ?? null)
            : null;
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            Submission fee: 0.50 USDC · settled on Arc
          </p>
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
