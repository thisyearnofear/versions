import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "VERSIONS — briefs become licensed tracks",
  description:
    "Tell VERSIONS what the picture needs. It ranks the alternate takes by fit, prepares the rights path, and brings you only the decisions that need a human — settling approved licenses in USDC on Arc.",
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
