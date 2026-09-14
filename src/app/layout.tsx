import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
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

export const metadata: Metadata = {
  title: "VERSIONS — music & product placements for distribution channels",
  description:
    "A marketplace where distribution channels browse music and product placements, pick what fits their ethos, and use it — free with attribution or paid as a sponsor slot. Matching, attribution tracking, and USDC settlement on Arc.",
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
