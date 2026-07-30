"use client";

// MODULAR: one-button live demo for judges. Drives the full
// submit → pay → review → publish → tip loop from the browser using
// only the existing public APIs (same flow as scripts/demo.ts) with
// a throwaway viem wallet, so the economy ticker, live stats, and
// chimes all fire in real time while the visitor watches. No new
// backend surface: every call below is an API any client can make.

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { setSoundEnabled } from "@/lib/audio-feedback";
import { track } from "@/lib/analytics";
import { agentIdentity } from "@/lib/agent-identity";
import type { AgentStreamEvent } from "@/lib/event-bus";

type StepStatus = "pending" | "active" | "done" | "failed";

interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
}

const STEP_LABELS = ["Submit", "Pay", "Agent review", "Publish", "Tip"] as const;

function initialSteps(): Step[] {
  return STEP_LABELS.map((label) => ({ label, status: "pending" }));
}

// MODULAR: progressive-enhancement snippets for the review step. Listens
// to agent-stream SSE scoped to one submissionId and paces one line per
// ~1.4s so a mock-mode burst still reads as agents working. Consensus
// flushes the queue. Polling remains the completion authority — on SSE
// error we close silently and the static detail stands.
function subscribeAgentSnippets(
  submissionId: string,
  onLine: (line: string, done: boolean) => void,
): () => void {
  const queue: string[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const es = new EventSource("/api/events");

  const stop = () => {
    if (closed) return;
    closed = true;
    es.close();
    if (timer) clearInterval(timer);
    timer = null;
  };

  const drain = () => {
    const line = queue.shift();
    if (line === undefined) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    onLine(line, false);
  };

  es.addEventListener("agent-stream", (msg) => {
    if (closed) return;
    try {
      const e = JSON.parse((msg as MessageEvent).data) as AgentStreamEvent;
      if (e.submissionId !== submissionId) return;
      if (e.type === "consensus") {
        queue.length = 0;
        if (timer) clearInterval(timer);
        timer = null;
        onLine("3/3 verdicts in", true);
        return;
      }
      if (e.type !== "agent_started" && e.type !== "agent_verdict") return;
      const id = agentIdentity(e.agentName);
      const line =
        e.type === "agent_started"
          ? `${id.icon} ${id.shortName}: reading the track…`
          : `${id.icon} ${id.shortName}: “${(e.notes ?? "").slice(0, 64)}…”`;
      if (timer) {
        queue.push(line);
      } else {
        onLine(line, false);
        timer = setInterval(drain, 1400);
      }
    } catch {
      /* malformed — ignore */
    }
  });
  es.onerror = () => stop();

  return stop;
}

// 1s of silence at 8kHz/16-bit/mono — built in memory, zero fixtures.
function makeSilentWav(): Blob {
  const sampleRate = 8000;
  const dataLength = sampleRate * 2;
  const buf = new ArrayBuffer(44 + dataLength);
  const v = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits/sample
  writeStr(36, "data");
  v.setUint32(40, dataLength, true);
  return new Blob([buf], { type: "audio/wav" });
}

function randomHex(bytes: number): `0x${string}` {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return `0x${Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

interface X402Challenge {
  resourceUrl: string;
  scheme: string;
  network: string;
  asset: string;
  payTo: `0x${string}`;
  amount: string;
  validUntil: number;
  puid: string;
}

export function LiveDemoButton() {
  const [steps, setSteps] = useState<Step[]>(initialSteps());
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  function setStep(i: number, status: StepStatus, detail?: string) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s)));
  }

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setSteps(initialSteps());
    setError(null);
    setPhase("running");
    setSoundEnabled(true); // chimes on — this click is the required user gesture
    track("demo_run", { source: "landing" });

    let failedStep = 0;
    let stopSnippets: (() => void) | null = null;
    let snippetSeen = false;
    try {
      // Step 1 — submit a silent demo track with a throwaway wallet.
      failedStep = 0;
      setStep(0, "active");
      const account = privateKeyToAccount(generatePrivateKey());
      const signature = await account.signMessage({ message: "VERSIONS_LEPTON_SUBMIT" });
      const form = new FormData();
      form.set("signature", signature);
      form.set("artistWallet", account.address);
      form.set(
        "metadata",
        JSON.stringify({
          title: `Live demo ${new Date().toISOString().slice(11, 19)}`,
          artistName: "Demo Artist",
          versionType: "demo",
          genre: "electronic",
          mood: "demo",
          description: "Submitted by the one-button live demo.",
        }),
      );
      form.set("audio", makeSilentWav(), "demo.wav");
      const submitRes = await fetch("/api/v1/submissions", { method: "POST", body: form });
      if (!submitRes.ok) throw new Error(`submit failed (${submitRes.status})`);
      const submitJson = await submitRes.json();
      const submissionId = String((submitJson.data ?? submitJson).id);
      setStep(0, "done", "track submitted");

      // Step 2 — verify payment (mock tx), which auto-fires the agent review.
      // Subscribe to agent-stream snippets BEFORE verify-payment: the review
      // starts server-side during that call, so the SSE connection must
      // already be open to catch the burst in mock mode.
      stopSnippets = subscribeAgentSnippets(submissionId, (line, done) => {
        snippetSeen = true;
        setStep(2, done ? "done" : "active", line);
      });
      failedStep = 1;
      setStep(1, "active");
      const verifyRes = await fetch(`/api/v1/submissions/${submissionId}/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: randomHex(32) }),
      });
      if (!verifyRes.ok) throw new Error(`payment verification failed (${verifyRes.status})`);
      setStep(1, "done", "0.50 USDC fee");

      // Step 3 + 4 — three agents review in parallel; publish fires at consensus.
      failedStep = 2;
      if (!snippetSeen) setStep(2, "active", "3 agents reviewing…");
      const start = Date.now();
      let status = "in_curation";
      while (Date.now() - start < 60_000) {
        await new Promise((r) => setTimeout(r, 1000));
        const pollRes = await fetch(`/api/v1/submissions/${submissionId}`);
        const pollJson = await pollRes.json().catch(() => null);
        status = pollJson?.data?.status ?? pollJson?.status ?? status;
        if (status === "published") break;
        if ((status === "awaiting_curation" || status === "in_curation") && !snippetSeen) {
          setStep(2, "active", "3 agents reviewing…");
        }
      }
      stopSnippets();
      stopSnippets = null;
      if (status !== "published") throw new Error(`review did not complete (last status: ${status})`);
      setStep(2, "done", "3/3 verdicts in");
      setStep(3, "done", "consensus reached");

      // Step 5 — x402 nanotip: 402 challenge, EIP-712 sign, settle.
      failedStep = 4;
      setStep(4, "active", "signing EIP-712 offer…");
      const tipBody = JSON.stringify({ artistWallet: account.address, amountUsdc: "0.000001" });
      const tipRes1 = await fetch("/api/x402/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: tipBody,
      });
      if (tipRes1.status !== 402) throw new Error(`expected 402 challenge, got ${tipRes1.status}`);
      const challengeB64 = tipRes1.headers.get("PAYMENT-REQUIRED");
      if (!challengeB64) throw new Error("missing PAYMENT-REQUIRED header");
      const challenge = JSON.parse(atob(challengeB64)) as X402Challenge;

      // Mirror the server's domain: actual Arc chainId or 1 in mock mode.
      const infoRes = await fetch("/api/v1/arc/info").then((r) => r.json()).catch(() => null);
      const chainIdHex = infoRes?.data?.chainId as string | null | undefined;
      const chainId = chainIdHex ? Number(BigInt(chainIdHex)) : 1;
      const tipSig = await account.signTypedData({
        domain: { name: "VERSIONS x402", version: "1", chainId },
        types: {
          Offer: [
            { name: "resourceUrl", type: "string" },
            { name: "scheme", type: "string" },
            { name: "network", type: "string" },
            { name: "asset", type: "string" },
            { name: "payTo", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "validUntil", type: "uint256" },
            { name: "puid", type: "string" },
          ],
        },
        primaryType: "Offer",
        message: {
          ...challenge,
          amount: BigInt(challenge.amount),
          validUntil: BigInt(challenge.validUntil),
        },
      });
      const proofB64 = btoa(JSON.stringify({ scheme: challenge.scheme, signature: tipSig, offer: challenge }));
      const tipRes2 = await fetch("/api/x402/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": proofB64 },
        body: tipBody,
      });
      if (!tipRes2.ok) throw new Error(`tip failed (${tipRes2.status})`);
      setStep(4, "done", "1 lepton settled");
      setPhase("done");
    } catch (e) {
      setStep(failedStep, "failed", e instanceof Error ? e.message : String(e));
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      stopSnippets?.();
      runningRef.current = false;
    }
  }

  return (
    <div className="text-center">
      <button
        type="button"
        onClick={run}
        disabled={phase === "running"}
        className="inline-flex items-center gap-3 border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-8 py-4 hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        {phase === "running" ? (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-rust)] animate-pulse" aria-hidden="true" />
            Agents at work…
          </>
        ) : phase === "done" ? (
          <>↻ Run it again</>
        ) : (
          <>▶ Watch the agents work — live</>
        )}
      </button>
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-3">
        Submits a real track · 3 AI agents review it · USDC settles · sound on
      </p>

      <AnimatePresence>
        {phase !== "idle" && (
          <motion.ol
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-3"
            aria-label="Live demo progress"
          >
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                <span
                  aria-hidden="true"
                  className={
                    s.status === "done"
                      ? "text-[var(--color-rust)]"
                      : s.status === "failed"
                        ? "text-red-600"
                        : s.status === "active"
                          ? "text-[var(--color-ink)]"
                          : "text-[var(--color-ink-3)]"
                  }
                >
                  {s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "active" ? "●" : `0${i + 1}`}
                </span>
                <span
                  className={
                    s.status === "pending" ? "text-[var(--color-ink-3)]" : "text-[var(--color-ink)]"
                  }
                >
                  {s.label}
                </span>
                {s.detail && s.status !== "pending" && (
                  <span className="text-[var(--color-ink-3)] normal-case tracking-normal">· {s.detail}</span>
                )}
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>

      {phase === "done" && (
        <p className="font-serif italic text-sm text-[var(--color-ink-2)] mt-4">
          That whole loop — review, publish, payouts, tip — ran with zero humans. Watch it land in the ticker below.
        </p>
      )}
      {phase === "error" && error && (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-600 mt-4">
          Demo hit a snag: {error}
        </p>
      )}
    </div>
  );
}
