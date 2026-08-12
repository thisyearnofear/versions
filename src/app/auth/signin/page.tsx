"use client";

// MODULAR: Custom NextAuth sign-in page. One CTA chains connect → EIP-191
// sign; when the wallet is already connected we auto-prompt the signature.
// Connected state shows ENS/avatar via ensdata + web3.bio (proxied).

import { Suspense, useEffect, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { SiteHeader } from "@/components/SiteHeader";
import { useCredentialsSignIn } from "@/lib/use-credentials-sign-in";
import { useWalletIdentity } from "@/lib/use-wallet-identity";
import { shortAddress } from "@/lib/wallet-identity";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/discover";
  const { status: sessionStatus } = useSession();
  const { address, isConnected, loading, error, signInWithWallet } =
    useCredentialsSignIn(callbackUrl);
  const { identity } = useWalletIdentity(isConnected ? address : null);
  const autoTried = useRef<string | null>(null);

  // Already signed in → bounce to callback.
  useEffect(() => {
    if (sessionStatus === "authenticated") {
      window.location.replace(callbackUrl);
    }
  }, [sessionStatus, callbackUrl]);

  // One-go UX: once the wallet connects, immediately request the signature.
  // Re-tries only when the address changes (not on every render / reject).
  useEffect(() => {
    if (!isConnected || !address) return;
    if (sessionStatus === "authenticated" || sessionStatus === "loading") return;
    if (loading) return;
    if (autoTried.current === address.toLowerCase()) return;
    autoTried.current = address.toLowerCase();
    void signInWithWallet({ source: "signin_page_auto" });
  }, [isConnected, address, sessionStatus, loading, signInWithWallet]);

  const displayName = identity?.displayName || (address ? shortAddress(address) : null);

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-3">
            Supervisor access
          </p>
          <h1 className="font-serif text-3xl font-black tracking-tight mb-2">Sign in</h1>
          <p className="font-serif text-base text-[var(--color-ink-2)] leading-snug">
            One step: connect your wallet, then approve a signature. No transaction, no gas, no cost.
          </p>
        </div>

        <div className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-8">
          {!isConnected ? (
            <div className="text-center space-y-6">
              <p className="font-serif text-base text-[var(--color-ink-2)]">
                Search stays free. Sign in to shortlist and license.
              </p>
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    disabled={!mounted}
                    className="w-full bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
                  >
                    Connect &amp; sign in
                  </button>
                )}
              </ConnectButton.Custom>
            </div>
          ) : (
            <div className="text-center space-y-5">
              <div className="flex flex-col items-center gap-3">
                {identity?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element -- ENS/IPFS hosts vary; avoid next/image allowlist churn
                  <img
                    src={identity.avatar}
                    alt=""
                    width={56}
                    height={56}
                    className="h-14 w-14 rounded-full object-cover border border-[var(--color-hair-strong)]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-14 w-14 rounded-full border border-[var(--color-hair-strong)] bg-[var(--color-ink)]/5"
                  />
                )}
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mb-1">
                    Connected as
                  </p>
                  <p className="font-serif text-xl font-black tracking-tight text-[var(--color-ink)]">
                    {displayName}
                  </p>
                  {identity?.ens && address && (
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-ink-3)] break-all">
                      {shortAddress(address)}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  autoTried.current = null;
                  void signInWithWallet({ source: "signin_page" });
                }}
                disabled={loading}
                className="w-full bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-4 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Approve signature in wallet…" : "Sign in with wallet →"}
              </button>
              {error && (
                <p className="font-serif text-sm text-[var(--color-rust)]">{error}</p>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Your signature proves wallet ownership · No gas · No transaction
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <Suspense
        fallback={
          <div className="flex-1 grid place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            Loading…
          </div>
        }
      >
        <SignInForm />
      </Suspense>
    </div>
  );
}
