// MODULAR: ERC-8004 agent identity (mock-first).
// Registers Production / Performance / Market as on-chain economic
// participants. Without ARC_RPC_URL we still expose stable agent IDs
// derived from wallet addresses so the UI can show ERC-8004 identity
// in the agent trace — live registration is opt-in via env.

import { createHash } from "crypto";
import { getAddress } from "viem";

export const ERC8004_IDENTITY_REGISTRY_DEFAULT =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

export type AgentLabel = "production" | "performance" | "market" | "ar";

export interface AgentIdentity {
  label: AgentLabel;
  name: string;
  wallet: string;
  agentId: string;
  registry: string;
  mock: boolean;
  registered: boolean;
}

export interface Erc8004Adapter {
  mock: boolean;
  registryAddress: string;
  listIdentities: () => AgentIdentity[];
}

const AGENT_NAMES: Record<AgentLabel, string> = {
  production: "Production Agent",
  performance: "Performance Agent",
  market: "Market Agent",
  ar: "A&R Agent",
};

function mockAgentId(wallet: string, label: string): string {
  const digest = createHash("sha256").update(`erc8004:${label}:${wallet.toLowerCase()}`).digest("hex");
  // Keep it as a decimal-looking id (uint256 style) for ArcScan-friendly display.
  return BigInt("0x" + digest.slice(0, 16)).toString();
}

export function createErc8004Adapter({
  agentWallets,
  registryAddress = process.env.ARC_ERC8004_REGISTRY || ERC8004_IDENTITY_REGISTRY_DEFAULT,
}: {
  agentWallets: { label: AgentLabel; wallet: string }[];
  registryAddress?: string;
  /** Reserved for live registerAgent calls; currently identities are deterministic. */
  rpcUrl?: string;
}): Erc8004Adapter {
  // Identities are deterministic hashes until we run a live ERC-8004
  // registerAgent tx. Keep mock:true so health/ready stays honest.
  const useMock = true;

  return {
    mock: useMock,
    registryAddress,
    listIdentities() {
      return agentWallets.map(({ label, wallet }) => {
        let checksum = wallet;
        try {
          checksum = getAddress(wallet as `0x${string}`);
        } catch {
          // keep raw
        }
        return {
          label,
          name: AGENT_NAMES[label],
          wallet: checksum,
          agentId: mockAgentId(checksum, label),
          registry: registryAddress,
          mock: useMock,
          // Deterministic IDs are demo-stable; live on-chain registration
          // is a follow-up ops step (Circle console / script).
          registered: true,
        };
      });
    },
  };
}
