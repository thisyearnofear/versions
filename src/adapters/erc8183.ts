// MODULAR: ERC-8183 job adapter for sync-license settlement.
// A music license maps onto the Agentic Commerce job lifecycle:
//   Open → Funded → Submitted → Completed
// with a deliverable hash of (brief + take + usage).
//
// Mock-first: without ARC_RPC_URL + platform key, every step returns
// deterministic hashes so the demo loop stays zero-dependency.
// Live mode uses the Arc testnet reference contract when configured.

import { createHash } from "crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http as viemHttp,
  keccak256,
  toHex,
  type Chain,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { microUsdcToBigInt } from "./arc";
import {
  agenticCommerceAbi,
  erc20ApproveAbi,
  ERC8183_CONTRACT_DEFAULT,
  ERC8183_STATUS,
  type Erc8183StatusName,
} from "../lib/erc8183-abi";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const EMPTY_BYTES = "0x" as Hex;

export interface LicenseJobParams {
  /** Client that funds escrow (platform brokering for the supervisor). */
  clientAddress: string;
  /** Provider that delivers the cleared license package (Market agent / platform). */
  providerAddress: string;
  /** Evaluator that calls complete (usually same as client). */
  evaluatorAddress: string;
  /** Human-readable job description (brief + take + artist). */
  description: string;
  /** Budget in USDC decimal string, e.g. "250.00". */
  budgetUsdc: string;
  /** bytes32 deliverable — keccak of license terms. */
  deliverableHash: Hex;
  /** Existing job id when settling a previously opened job. */
  jobId?: string | null;
}

export interface LicenseJobOpenResult {
  jobId: string;
  createTxHash: string;
  status: Erc8183StatusName;
  mock: boolean;
}

export interface LicenseJobSettleResult {
  jobId: string;
  createTxHash: string | null;
  fundTxHash: string;
  submitTxHash: string;
  completeTxHash: string;
  deliverableHash: Hex;
  status: Erc8183StatusName;
  mock: boolean;
}

export interface Erc8183Adapter {
  mock: boolean;
  contractAddress: string;
  /** Open a job (Open state). Idempotent when jobId already known. */
  openLicenseJob: (params: LicenseJobParams) => Promise<LicenseJobOpenResult>;
  /** Run Open→Funded→Submitted→Completed (opens first if needed). */
  settleLicenseJob: (params: LicenseJobParams) => Promise<LicenseJobSettleResult>;
}

function deterministicHash(payload: Record<string, unknown>): Hex {
  return (`0x` + createHash("sha256").update(JSON.stringify(payload)).digest("hex")) as Hex;
}

function mockJobId(seed: string): string {
  const n = BigInt("0x" + createHash("sha256").update(seed).digest("hex").slice(0, 16));
  return n.toString();
}

/** Stable bytes32 deliverable for a license package. */
export function licenseDeliverableHash(input: {
  briefHash: string;
  submissionId: string;
  usageType: string;
  feeUsdc: string;
}): Hex {
  return keccak256(
    toHex(
      JSON.stringify({
        briefHash: input.briefHash,
        submissionId: input.submissionId,
        usageType: input.usageType,
        feeUsdc: input.feeUsdc,
        standard: "ERC-8183",
        kind: "versions.sync_license",
      }),
    ),
  );
}

export function createErc8183Adapter({
  rpcUrl,
  usdcContract,
  contractAddress = process.env.ARC_ERC8183_CONTRACT || ERC8183_CONTRACT_DEFAULT,
  clientPrivateKey,
  providerPrivateKey,
}: {
  rpcUrl?: string;
  usdcContract?: string;
  contractAddress?: string;
  clientPrivateKey?: string;
  providerPrivateKey?: string;
}): Erc8183Adapter {
  const useMock = !rpcUrl || !clientPrivateKey || !providerPrivateKey || !usdcContract;

  function normalizeKey(key: string): `0x${string}` {
    const trimmed = key.trim();
    return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  }

  async function liveClients() {
    const clientAccount = privateKeyToAccount(normalizeKey(clientPrivateKey!));
    const providerAccount = privateKeyToAccount(normalizeKey(providerPrivateKey!));

    const chainIdHex = await fetch(rpcUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    }).then((r) => r.json() as Promise<{ result?: string }>);
    const chainIdNum = Number(BigInt(chainIdHex.result ?? "0x1"));
    const chain: Chain = {
      id: chainIdNum,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
      rpcUrls: { default: { http: [rpcUrl!] }, public: { http: [rpcUrl!] } },
      blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
    };
    const transport = viemHttp(rpcUrl!);
    const publicClient = createPublicClient({ chain, transport });
    const clientWallet = createWalletClient({ account: clientAccount, chain, transport });
    const providerWallet = createWalletClient({ account: providerAccount, chain, transport });
    return { publicClient, clientWallet, providerWallet, clientAccount, providerAccount, chain };
  }

  async function extractJobId(txHash: Hash, publicClient: Awaited<ReturnType<typeof liveClients>>["publicClient"]): Promise<string> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: agenticCommerceAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "JobCreated") {
          return (decoded.args as { jobId: bigint }).jobId.toString();
        }
      } catch {
        // not our event
      }
    }
    throw new Error("Could not parse JobCreated event");
  }

  return {
    mock: useMock,
    contractAddress,

    async openLicenseJob(params) {
      if (params.jobId) {
        return {
          jobId: params.jobId,
          createTxHash: deterministicHash({ kind: "reuse", jobId: params.jobId }),
          status: "Open",
          mock: useMock,
        };
      }

      if (useMock) {
        const jobId = mockJobId(`open:${params.description}:${params.budgetUsdc}:${params.deliverableHash}`);
        return {
          jobId,
          createTxHash: deterministicHash({ kind: "createJob", jobId, description: params.description }),
          status: "Open",
          mock: true,
        };
      }

      const { publicClient, clientWallet, providerAccount, clientAccount } = await liveClients();
      const block = await publicClient.getBlock();
      const expiredAt = block.timestamp + 86_400n * 30n; // 30 days
      const hash = await clientWallet.writeContract({
        address: contractAddress as `0x${string}`,
        abi: agenticCommerceAbi,
        functionName: "createJob",
        args: [
          (params.providerAddress || providerAccount.address) as `0x${string}`,
          (params.evaluatorAddress || clientAccount.address) as `0x${string}`,
          expiredAt,
          params.description,
          ZERO_ADDRESS,
        ],
      });
      const jobId = await extractJobId(hash, publicClient);
      return { jobId, createTxHash: hash, status: "Open", mock: false };
    },

    async settleLicenseJob(params) {
      const deliverableHash = params.deliverableHash;
      const budget = microUsdcToBigInt(params.budgetUsdc);

      if (useMock) {
        const opened = await this.openLicenseJob(params);
        const jobId = opened.jobId;
        return {
          jobId,
          createTxHash: opened.createTxHash,
          fundTxHash: deterministicHash({ kind: "fund", jobId }),
          submitTxHash: deterministicHash({ kind: "submit", jobId, deliverableHash }),
          completeTxHash: deterministicHash({ kind: "complete", jobId }),
          deliverableHash,
          status: "Completed",
          mock: true,
        };
      }

      const { publicClient, clientWallet, providerWallet, clientAccount, providerAccount } =
        await liveClients();

      let jobId = params.jobId ?? null;
      let createTxHash: string | null = null;
      if (!jobId) {
        const opened = await this.openLicenseJob(params);
        jobId = opened.jobId;
        createTxHash = opened.createTxHash;
      }
      const jobIdBig = BigInt(jobId);

      await providerWallet.writeContract({
        address: contractAddress as `0x${string}`,
        abi: agenticCommerceAbi,
        functionName: "setBudget",
        args: [jobIdBig, budget, EMPTY_BYTES],
      });

      await clientWallet.writeContract({
        address: usdcContract as `0x${string}`,
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [contractAddress as `0x${string}`, budget],
      });

      const fundTxHash = await clientWallet.writeContract({
        address: contractAddress as `0x${string}`,
        abi: agenticCommerceAbi,
        functionName: "fund",
        args: [jobIdBig, EMPTY_BYTES],
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTxHash, timeout: 60_000 });

      const submitTxHash = await providerWallet.writeContract({
        address: contractAddress as `0x${string}`,
        abi: agenticCommerceAbi,
        functionName: "submit",
        args: [jobIdBig, deliverableHash, EMPTY_BYTES],
      });
      await publicClient.waitForTransactionReceipt({ hash: submitTxHash, timeout: 60_000 });

      const reasonHash = keccak256(toHex("versions.license.approved"));
      const completeTxHash = await clientWallet.writeContract({
        address: contractAddress as `0x${string}`,
        abi: agenticCommerceAbi,
        functionName: "complete",
        args: [jobIdBig, reasonHash, EMPTY_BYTES],
      });
      await publicClient.waitForTransactionReceipt({ hash: completeTxHash, timeout: 60_000 });

      void clientAccount;
      void providerAccount;
      void ERC8183_STATUS;

      return {
        jobId,
        createTxHash,
        fundTxHash,
        submitTxHash,
        completeTxHash,
        deliverableHash,
        status: "Completed",
        mock: false,
      };
    },
  };
}
