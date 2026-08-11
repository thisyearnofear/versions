"use client";

// MODULAR: RainbowKit ConnectButton wrapper. The vanilla app's wallet
// logic was Phantom (Solana) + a hand-rolled EVM adapter; the new
// stack uses wagmi v2 + RainbowKit, which already handles the
// wallet selection UX + chain switching. This component is the
// single drop-in for any page that wants a Connect button.

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { useCallback, useEffect, useRef } from "react";
import { WalletGlossary } from "@/components/wallet/WalletGlossary";
import { track } from "@/lib/analytics";

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

  // MODULAR: fire analytics when the wallet connects / disconnects.
  // Only tracks the boolean (connected: true), not the address — no PII.
  const prevConnected = useRef(false);
  useEffect(() => {
    if (isConnected && !prevConnected.current) {
      track("wallet_connected", { variant });
    } else if (!isConnected && prevConnected.current) {
      track("wallet_disconnected", { variant });
    }
    prevConnected.current = isConnected;
  }, [isConnected, variant]);

  const links =
    isConnected && address ? (
      <>
        <Link
          href={`/artists/${address}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] hover:text-[var(--color-rust)] transition-colors"
        >
          Artist
        </Link>
        <Link
          href={`/curators/${address}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] hover:text-[var(--color-rust)] transition-colors"
        >
          Curator
        </Link>
        <Link
          href={`/listeners/${address}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] hover:text-[var(--color-rust)] transition-colors"
        >
          Listener
        </Link>
      </>
    ) : null;

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

  // MODULAR: supervisor-first variant — a quiet "Sign in" affordance when
  // disconnected (no loud wallet CTA at the front door) and a slim address
  // chip once connected. The connect/account modal still opens on click, so
  // the action stays reachable in ≤2 clicks, just not loud.
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
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
                  title="Search is free without a wallet — sign in to settle & persist"
                >
                  Sign in
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAccountModal}
                  className="flex items-center gap-2 border border-[var(--color-hair-strong)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink)] hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
                >
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[var(--color-rust)]" />
                  {account.displayName}
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
        {links}
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
