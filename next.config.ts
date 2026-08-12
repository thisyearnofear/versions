import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      ".git/**",
      "data/**",
      ".env",
      ".env.local",
      ".env.example",
      "*.pdf",
      "*.pptx",
      ".qoder/**",
      "scripts/**",
      "drizzle/**",
      "docs/**",
      // Client-only wallet sign-in hook must not be bundled with server routes.
      "src/lib/use-credentials-sign-in.ts",
      "node_modules/@reown/**",
      "node_modules/@walletconnect/**",
      "node_modules/@metamask/**",
      "node_modules/@coinbase/**",
      "node_modules/@base-org/**",
      "node_modules/porto/**",
      "node_modules/@rainbow-me/**",
      "node_modules/@solana/**",
      "node_modules/@electric-sql/**",
      "node_modules/drizzle-kit/**",
      "node_modules/typescript/**",
      "node_modules/@rolldown/**",
      "node_modules/@esbuild/**",
      "node_modules/@esbuild-kit/**",
      "node_modules/@img/**",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  turbopack: {
    root: projectRoot,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "*.ipfs.w3s.link" },
    ],
  },
  // viem uses native Node.js crypto modules that webpack can't resolve in the browser
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        os: false,
        url: false,
      };
    }
    return config;
  },
};

export default nextConfig;
