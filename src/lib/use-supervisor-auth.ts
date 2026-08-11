"use client";

import { useCallback } from "react";
import { useSession } from "next-auth/react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";

export function useSupervisorAuth() {
  const { data: session, status } = useSession();
  const { isConnected, address } = useAccount();
  const router = useRouter();

  const walletAddress = (session?.user as { walletAddress?: string } | undefined)?.walletAddress;
  const isAuthenticated = status === "authenticated" && !!walletAddress;
  const isLoading = status === "loading";

  const requireAuth = useCallback(
    (returnTo?: string) => {
      if (isAuthenticated) return true;
      const callback = returnTo ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/discover");
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
      return false;
    },
    [isAuthenticated, router],
  );

  return {
    isAuthenticated,
    isLoading,
    isConnected,
    address,
    walletAddress,
    requireAuth,
  };
}
