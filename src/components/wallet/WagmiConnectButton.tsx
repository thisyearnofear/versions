"use client";

// MODULAR: RainbowKit ConnectButton wrapper. The vanilla app's wallet
// logic was Phantom (Solana) + a hand-rolled EVM adapter; the new
// stack uses wagmi v2 + RainbowKit, which already handles the
// wallet selection UX + chain switching. This component is the
// single drop-in for any page that wants a Connect button.

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef } from "react";
import { WalletGlossary } from "@/components/wallet/WalletGlossary";
import { track } from "@/lib/analytics";
import { useCredentialsSignIn } from "@/lib/use-credentials-sign-in";
import { useWalletIdentity } from "@/lib/use-wallet-identity";
import { shortAddress } from "@/lib/wallet-identity";

export interface WagmiConnectButtonProps {
  // "default" | "compact" render RainbowKit's built-in button (address chip).
  // "quiet" is supervisor-first: a subtle, low-emphasis "Sign in" when
  // disconnected (no wallet CTA at the front door) and a slim address chip
  // once connected. Search stays guest-first either way.
  variant?: "default" | "compact" | "quiet";
  // Optional: when true, include the inline "What is a wallet?" glossary
  // below the connect button. Off by default because pages with
  // dedicated dashboard chrome usually have their own explainer.
  showGlossary?: boolean;
  // Optional: a child slot — render extra elements (e.g. earnings chip) on the right.
  children?: React.ReactNode;
}

export function WagmiConnectButton({ variant = "default", children, showGlossary = false }: WagmiConnectButtonProps) {
  const { address, isConnected } = useAccount();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const { identity } = useWalletIdentity(isConnected ? address : null);
  const { loading: signingIn, signInWithWallet } = useCredentialsSignIn("/discover");

  // MODULAR: fire analytics when the wallet connects / disconnects.
  // Only tracks the boolean (connected: true), not the address — no PII.
  // Quiet variant: on a fresh connect, chain straight into the EIP-191 sign
  // so "Sign in" → wallet pick → signature is one continuous flow.
  const prevConnected = useRef(false);
  useEffect(() => {
    const wasConnected = prevConnected.current;
    if (isConnected && !wasConnected) {
      track("wallet_connected", { variant });
      if (variant === "quiet" && sessionStatus === "unauthenticated") {
        const callbackUrl =
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "/discover";
        void signInWithWallet({ source: "header_auto", callbackUrl });
      }
    } else if (!isConnected && wasConnected) {
      track("wallet_disconnected", { variant });
    }
    prevConnected.current = isConnected;
  }, [isConnected, variant, sessionStatus, signInWithWallet]);

  // MODULAR: IA consolidation — the per-wallet Artist/Curator/Listener
  // dashboards are NOT primary jobs, so they stay out of the header nav
  // (they remain reachable by direct URL). The header is the three doors
  // + system proof + wallet chip only.

  const button = (
    <ConnectButton
      accountStatus={
        variant === "compact"
          ? { smallScreen: "avatar", largeScreen: "address" }
          : "address"
      }
      chainStatus="icon"
      showBalance={false}
    />
  );

  const chipLabel =
    identity?.displayName ||
    (address ? shortAddress(address) : "Account");

  // MODULAR: supervisor-first variant — a quiet "Sign in" affordance when
  // disconnected (no loud wallet CTA at the front door) and a slim address
  // chip once connected. Connect → sign chains when finishing auth inline.
  const control =
    variant === "quiet" ? (
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
          const ready = mounted;
          const connected = ready && !!account && !!chain;
          return (
            <div
              {...(!ready ? { "aria-hidden": true } : {})}
              style={{ opacity: ready ? 1 : 0, pointerEvents: ready ? "auto" : "none" }}
            >
              {!connected ? (
                <button
                  type="button"
                  onClick={openConnectModal}
                  className="flex min-h-[44px] items-center px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-rust)]"
                  title="Search is free — sign in to shortlist and license"
                >
                  Sign in
                </button>
              ) : !isAuthenticated ? (
                <button
                  type="button"
                  onClick={() =>
                    void signInWithWallet({
                      source: "header_finish",
                      callbackUrl:
                        typeof window !== "undefined"
                          ? window.location.pathname + window.location.search
                          : "/discover",
                    })
                  }
                  disabled={signingIn}
                  className="flex min-h-[44px] items-center gap-2 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] transition-opacity hover:opacity-80 disabled:opacity-50"
                  title="Approve a signature to finish sign in — no gas"
                >
                  {identity?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={identity.avatar}
                      alt=""
                      width={16}
                      height={16}
                      className="h-4 w-4 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                  {signingIn ? "Approve signature…" : `Sign as ${chipLabel}`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAccountModal}
                  className="flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink)] transition-colors hover:border-[var(--color-rust)] hover:text-[var(--color-rust)]"
                >
                  {identity?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={identity.avatar}
                      alt=""
                      width={16}
                      height={16}
                      className="h-4 w-4 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[var(--color-rust)]" />
                  )}
                  {chipLabel}
                </button>
              )}
            </div>
          );
        }}
      </ConnectButton.Custom>
    ) : (
      button
    );

  return (
    <div className="flex flex-col items-end gap-0">
      <div className="flex items-center gap-3">
        {control}
        {children}
      </div>
      {showGlossary && !isConnected && (
        <div className="w-full max-w-[420px] mt-3">
          <WalletGlossary variant="compact" />
        </div>
      )}
    </div>
  );
}

// MODULAR: a small hook that returns the active wallet + helpers. Pages
// import this to get a stable shape regardless of the underlying
// connector (MetaMask, Coinbase Wallet, WalletConnect, injected).
export function useWallet() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const signAs = useCallback(
    async (message: string, expectedAddress?: `0x${string}`) => {
      if (!address) throw new Error("Wallet not connected.");
      if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
        const err = new Error("Connected wallet does not match the expected address.");
        (err as Error & { code?: string }).code = "wallet_mismatch";
        throw err;
      }
      const signature = await signMessageAsync({ message });
      return { signature, address };
    },
    [address, signMessageAsync],
  );

  return {
    address: address ?? null,
    chainId,
    isConnected,
    disconnect,
    signAs,
  };
}
