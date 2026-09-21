import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import { APP_URL } from "@/lib/attribution";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

// Mobile-first viewport: cover the notch, pinch-zoom stays allowed
// (accessibility), browser chrome picks up the paper tone.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4efe5",
};

const SITE_TITLE = "VERSIONS — music & product placements that fit your channel";
const SITE_DESCRIPTION =
  "Find listings that fit what you publish. Use free listings with the required credit, or buy a paid placement with clear pricing, disclosure, tracking, and settlement in USDC on Arc.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "VERSIONS — music & product placements for distribution channels",
    template: "%s · VERSIONS",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "VERSIONS",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <div className="grain-overlay" aria-hidden="true" />
          <div className="vignette-overlay" aria-hidden="true" />
          <div className="app-content flex flex-col min-h-screen">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
