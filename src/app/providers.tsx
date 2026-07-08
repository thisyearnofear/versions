"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { SessionProvider } from "next-auth/react";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/ui/Toast";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import "@rainbow-me/rainbowkit/styles.css";
import { MotionConfig } from "framer-motion";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: "#c84a1f",
              accentColorForeground: "#f4efe5",
              borderRadius: "none",
              fontStack: "system",
            })}
            modalSize="compact"
          >
            <MotionConfig reducedMotion="user"><AnalyticsProvider><ToastProvider>{children}</ToastProvider></AnalyticsProvider></MotionConfig>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </SessionProvider>
  );
}
