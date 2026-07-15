"use client";

// MODULAR: Custom NextAuth sign-in page. The app uses RainbowKit for
// wallet connection, but NextAuth's Credentials provider needs a
// server-side sign-in route to establish a session. This page provides
// a wallet-signature-based sign-in flow that bridges RainbowKit's
// client-side connection with NextAuth's server-side session.
//
// The flow:
// 1. User connects wallet via RainbowKit (already in SiteHeader)
// 2. User clicks "Sign in with wallet" on this page
// 3. We request a signature for a deterministic message
// 4. We POST { address, signature, message } to /api/auth/callback/credentials
// 5. NextAuth validates the signature via verifyMessage and creates a session

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { track } from "@/lib/analytics";

const SIGN_MESSAGE = "Sign in to VERSIONS marketplace\n\nThis signature verifies your wallet ownership and creates a session. No transaction is initiated.\n\nBy signing, you agree to the VERSIONS terms of service.";

export default function SignInPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!address) return;
    setLoading(true);
    setError(null);
    track("wallet_connect_click", { source: "signin_page" });
    try {
      const signature = await signMessageAsync({
        account: address,
        message: SIGN_MESSAGE,
      });
      const result = await signIn("credentials", {
        address,
        signature,
        message: SIGN_MESSAGE,
        redirect: false,
        callbackUrl: "/",
      });
      if (result?.error) {
        setError("Authentication failed. Please try again.");
      } else if (result?.url) {
        track("wallet_connected", { source: "signin_page" });
        window.location.href = result.url;
      }
    } catch (err) {
      setError(
        err instanceof Error && err.name === "UserRejectedRequestError"
          ? "Signature rejected. Please approve the signature to sign in."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link
              href="/"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
            >
              ← Back to VERSIONS
            </Link>
            <h1 className="font-serif text-3xl font-black tracking-tight mt-6 mb-2">
              Sign in
            </h1>
            <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug">
              Connect a wallet and sign a message to verify ownership.
              No transaction, no gas, no cost.
            </p>
          </div>

          <div className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-8">
            {!isConnected ? (
              <div className="text-center">
                <p className="font-serif text-base text-[var(--color-ink-2)] mb-6">
                  First, connect your wallet using the button in the header.
                </p>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                  ↑ Use the connect button at the top
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-2">
                  Connected as
                </p>
                <p className="font-mono text-sm text-[var(--color-ink)] mb-6 break-all">
                  {address}
                </p>
                <button
                  type="button"
                  onClick={() => void handleSignIn()}
                  disabled={loading}
                  className="w-full bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Waiting for signature…" : "Sign in with wallet →"}
                </button>
                {error && (
                  <p className="mt-4 font-serif text-sm text-[var(--color-rust)]">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            Your signature proves wallet ownership · No gas · No transaction
          </p>
        </div>
      </main>
    </div>
  );
}
