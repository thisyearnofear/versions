import { http, createConfig } from "wagmi";
import { mainnet, base, arbitrum, sepolia, baseSepolia } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { defineChain } from "viem";

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

// MODULAR: Arc testnet (Circle's L1 sidechain for USDC settlement).
// Chain ID 5042002 per the public Arc docs. Defining it here (rather
// than importing from wagmi/chains) because wagmi doesn't ship an
// Arc chain by default. The RPC URL is overridable via env so
// operators can pin to a private RPC; falls back to Circle's
// public testnet endpoint. nativeCurrency is USDC because Arc
// uses USDC for gas (not ETH); decimals=6 matches the ERC-20
// USDC convention so wagmi + RainbowKit display balances
// correctly (decimals=18 would round-trip raw amounts to wildly
// wrong UI values).
// MODULAR: `as const` keeps the literal type `5042002` instead of
// widening to `number`. Without this, wagmi's Register augmentation
// degrades the chainId literal union to `number` (because
// `defineChain({ id: ARC_TESTNET_ID })` carries the widened type
// into the chains tuple), and the type system can no longer
// protect against an unknown chainId at compile time.
export const ARC_TESTNET_ID = 5042002 as const;
const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [mainnet, base, baseSepolia, arbitrum, sepolia, arcTestnet],
  connectors: [
    injected(),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
    coinbaseWallet({ appName: "VERSIONS" }),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrum.id]: http(),
    [sepolia.id]: http(),
    [arcTestnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
