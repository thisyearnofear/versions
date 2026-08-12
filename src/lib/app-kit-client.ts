"use client";

// MODULAR: Circle App Kit helpers for the supervisor "sync budget" surface.
// Browser-only — adapters need an EIP-1193 provider from the connected wallet.

import type { EIP1193Provider } from "viem";

export async function createBrowserAppKitAdapter(provider: EIP1193Provider) {
  const [{ createViemAdapterFromProvider }, { ArcTestnet, BaseSepolia }] = await Promise.all([
    import("@circle-fin/adapter-viem-v2"),
    import("@circle-fin/app-kit/chains"),
  ]);
  return createViemAdapterFromProvider({
    provider,
    capabilities: {
      supportedChains: [BaseSepolia, ArcTestnet],
    },
  });
}

export async function getAppKit() {
  const { AppKit } = await import("@circle-fin/app-kit");
  return new AppKit();
}

/** App Kit Send: USDC on Arc Testnet → recipient (platform treasury). */
export async function appKitSendUsdcOnArc(args: {
  provider: EIP1193Provider;
  to: string;
  amount: string;
}): Promise<{ txHash?: string; explorerUrl?: string; state?: string; mock?: boolean }> {
  const kit = await getAppKit();
  const adapter = await createBrowserAppKitAdapter(args.provider);
  const { resolveChainIdentifier } = await import("@circle-fin/adapter-viem-v2");
  const chain = resolveChainIdentifier("Arc_Testnet");
  if (chain.type === "evm") {
    await adapter.ensureChain(chain);
  }
  const result = await kit.send({
    from: { adapter, chain: "Arc_Testnet" },
    to: args.to,
    amount: args.amount,
    token: "USDC",
  });
  const r = result as { txHash?: string; explorerUrl?: string; state?: string };
  return { txHash: r.txHash, explorerUrl: r.explorerUrl, state: r.state };
}

/**
 * Unified Balance: deposit USDC from Base Sepolia, then spend on Arc Testnet
 * to the platform wallet — the "fund sync budget from another chain" path.
 */
export async function appKitUnifiedBalanceFundArc(args: {
  provider: EIP1193Provider;
  to: string;
  amount: string;
}): Promise<{
  depositTx?: string;
  spendTx?: string;
  explorerUrl?: string;
  mock?: boolean;
}> {
  const kit = await getAppKit();
  const adapter = await createBrowserAppKitAdapter(args.provider);
  const { resolveChainIdentifier } = await import("@circle-fin/adapter-viem-v2");

  const base = resolveChainIdentifier("Base_Sepolia");
  if (base.type === "evm") {
    await adapter.ensureChain(base);
  }
  const deposit = await kit.unifiedBalance.deposit({
    from: { adapter, chain: "Base_Sepolia" },
    amount: args.amount,
    token: "USDC",
  });

  const arc = resolveChainIdentifier("Arc_Testnet");
  if (arc.type === "evm") {
    await adapter.ensureChain(arc);
  }
  const spend = await kit.unifiedBalance.spend({
    from: { adapter },
    amount: args.amount,
    token: "USDC",
    to: {
      adapter,
      chain: "Arc_Testnet",
      recipientAddress: args.to,
    },
  });

  const d = deposit as { txHash?: string };
  const s = spend as { txHash?: string; explorerUrl?: string };
  return {
    depositTx: d.txHash,
    spendTx: s.txHash,
    explorerUrl: s.explorerUrl,
  };
}
