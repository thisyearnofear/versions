"use client";

// MODULAR: Shared NextAuth credentials sign-in via EIP-191 message.
// Used by /auth/signin and the header "Finish sign in" chip so connect
// → sign can chain without a second page hop when already connected.

import { useCallback, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { signIn } from "next-auth/react";
import { track } from "@/lib/analytics";

export const WALLET_SIGN_IN_MESSAGE =
  "Sign in to VERSIONS marketplace\n\nThis signature verifies your wallet ownership and creates a session. No transaction is initiated.\n\nBy signing, you agree to the VERSIONS terms of service.";

export function useCredentialsSignIn(callbackUrl = "/discover") {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const signInWithWallet = useCallback(
    async (opts?: { source?: string; redirect?: boolean; callbackUrl?: string }) => {
      if (!address || inFlight.current) return false;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      const source = opts?.source ?? "credentials_sign_in";
      const nextUrl = opts?.callbackUrl ?? callbackUrl;
      track("wallet_connect_click", { source });
      try {
        const signature = await signMessageAsync({
          account: address,
          message: WALLET_SIGN_IN_MESSAGE,
        });
        const result = await signIn("credentials", {
          address,
          signature,
          message: WALLET_SIGN_IN_MESSAGE,
          redirect: false,
          callbackUrl: nextUrl,
        });
        if (result?.error) {
          setError("Authentication failed. Please try again.");
          return false;
        }
        track("wallet_connected", { source });
        if (opts?.redirect !== false) {
          window.location.href = result?.url || nextUrl;
        }
        return true;
      } catch (err) {
        setError(
          err instanceof Error && err.name === "UserRejectedRequestError"
            ? "Signature rejected. Please approve the signature to sign in."
            : "Something went wrong. Please try again.",
        );
        return false;
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [address, callbackUrl, signMessageAsync],
  );

  return {
    address,
    isConnected,
    loading,
    error,
    setError,
    signInWithWallet,
  };
}
