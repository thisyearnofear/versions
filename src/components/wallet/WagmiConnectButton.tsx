"use client";

// MODULAR: RainbowKit ConnectButton wrapper. The vanilla app's wallet
// logic was Phantom (Solana) + a hand-rolled EVM adapter; the new
// stack uses wagmi v2 + RainbowKit, which already handles the
// wallet selection UX + chain switching. This component is the
// single drop-in for any page that wants a Connect button.

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { useCallback } from "react";

export interface WagmiConnectButtonProps {
  // Optional: show the short address chip inline (otherwise RainbowKit's
  // default button is rendered, which already includes the address).
  variant?: "default" | "compact";
  // Optional: a child slot — render extra elements (e.g. earnings chip) on the right.
  children?: React.ReactNode;
}

export function WagmiConnectButton({ variant = "default", children }: WagmiConnectButtonProps) {
  const { address, isConnected } = useAccount();

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

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3">
        {links}
        <ConnectButton
          accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
          chainStatus={{ smallScreen: "icon", largeScreen: "icon" }}
          showBalance={false}
        />
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {links}
      <ConnectButton
        accountStatus="address"
        chainStatus="icon"
        showBalance={false}
      />
      {children}
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
