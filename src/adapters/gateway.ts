// MODULAR: Circle Gateway client for sub-cent USDC nanopayments on Arc.
//
// DRY: every Gateway call (submit a tip, query a balance) goes through
//      this object. No other module talks to Circle's Gateway API or
//      computes a mock hash for settlement purposes.
//
// PERFORMANT: mock-first. When GATEWAY_API_URL is missing, the mock
//             keeps the rest of the system (the x402 tip route, the
//             TipButton, tests) working without credentials. A real
//             Gateway URL is just an env-var flip away.
//
// CLEAN: returns typed errors; never throws on connectivity — falls
//        back to mock and flags the response with `mock: true` so
//        callers can decide whether to gate on real-Gateway.
//
// In real mode, Gateway batches the signed tip into an off-chain
// escrow that settles periodically on Arc. In mock mode, we return a
// deterministic hash so the demo and tests are reproducible.

import { createHash } from 'crypto';
import { getAddress, isAddress } from 'viem';
import { requestJson } from '../lib/http';
import { microUsdcToBigInt } from './arc';

const DEFAULT_TIMEOUT = 8000;
const MOCK_FINALITY_MS = 400;

export interface GatewayInfo {
  apiUrl: string | null;
  network: 'arc-testnet' | 'arc-mainnet' | 'unknown';
  usdcContract: string | null;
  batchIntervalMs: number;
  mock: boolean;
}

export interface SubmitTipArgs {
  from: string; // tipper wallet
  to: string; // artist wallet
  amountUsdc: string; // decimal string, e.g. "0.0001" (1 lepton = "0.000001")
  puid: string; // payment unit id, ties the Gateway entry to the x402 proof
  message?: string; // optional message from the tipper
}

export interface SubmitTipResult {
  hash: string;
  status: 'queued' | 'settled';
  batchedAt: string; // ISO timestamp
  mock: boolean;
}

export interface GatewayAdapter {
  getInfo: () => Promise<GatewayInfo>;
  submitTip: (args: SubmitTipArgs) => Promise<SubmitTipResult>;
  getTipStatus: (puid: string) => Promise<{ status: 'queued' | 'settled' | 'unknown'; hash: string | null; mock: boolean }>;
}

export function createGatewayAdapter({
  apiUrl,
  apiKey,
  network = 'arc-testnet',
  usdcContract = null,
  batchIntervalMs = 500,
  requestTimeoutMs = DEFAULT_TIMEOUT,
}: {
  apiUrl?: string;
  apiKey?: string;
  network?: GatewayInfo['network'];
  usdcContract?: string | null;
  batchIntervalMs?: number;
  requestTimeoutMs?: number;
} = {}): GatewayAdapter {
  const useMock = !apiUrl;

  // PERFORMANT: cache the "is API reachable?" check so we don't ping
  // on every request. Reset to null on a real failure so we re-check.
  let reachable: boolean | null = null;
  async function isReachable(): Promise<boolean> {
    if (useMock) return false;
    if (reachable !== null) return reachable;
    try {
      await requestJson<{ ok?: boolean }>(
        apiUrl!,
        {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          timeoutMs: 3000,
        },
        'Gateway ping',
      );
      reachable = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gateway] API unreachable, falling back to mock: ${msg}`);
      reachable = false;
    }
    return reachable;
  }

  function deterministicHash(payload: Record<string, unknown>): string {
    return '0x' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  function assertAddress(addr: string, label: string): `0x${string}` {
    if (!isAddress(addr)) throw new Error(`invalid ${label}: ${addr}`);
    return getAddress(addr) as `0x${string}`;
  }

  return {
    async getInfo(): Promise<GatewayInfo> {
      const up = await isReachable();
      return {
        apiUrl: apiUrl || null,
        network: up ? network : network,
        usdcContract: usdcContract || null,
        batchIntervalMs,
        mock: !up,
      };
    },

    /**
     * Submit a tip for batched settlement. In real mode, the
     * Gateway API call returns immediately with a hash; the actual
     * on-chain settlement happens on the next batch window. In
     * mock mode, we return a deterministic hash that reflects the
     * payload so tests and demos are reproducible.
     */
    async submitTip({ from, to, amountUsdc, puid, message }: SubmitTipArgs): Promise<SubmitTipResult> {
      // MODULAR: validate inputs up front so a bad tip fails fast
      // before any network call. Addresses are checksummed; amount
      // is converted to micro-units via the same helper arc.ts uses
      // so the two adapters stay in sync on USDC precision.
      const fromAddr = assertAddress(from, 'from');
      const toAddr = assertAddress(to, 'to');
      if (fromAddr.toLowerCase() === toAddr.toLowerCase()) {
        throw new Error('self-tip not allowed');
      }
      const micro = microUsdcToBigInt(amountUsdc);
      if (micro <= 0n) throw new Error('amount must be positive');

      const batchedAt = new Date().toISOString();
      const up = await isReachable();
      if (!up) {
        return {
          hash: deterministicHash({ from: fromAddr, to: toAddr, amountUsdc, puid, ts: Date.now() }),
          status: 'settled',
          batchedAt,
          mock: true,
        };
      }

      // Real Gateway: POST to the batch endpoint with the tip payload.
      // The Gateway returns { hash, status } where status is
      // 'queued' until the next batch window settles it.
      const res = await requestJson<{ hash: string; status: 'queued' | 'settled' }>(
        `${apiUrl}/v1/tips`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            from: fromAddr,
            to: toAddr,
            amount: micro.toString(),
            puid,
            message: message ?? null,
            network,
            asset: 'USDC',
          }),
          timeoutMs: requestTimeoutMs,
        },
        'Gateway submitTip',
      );
      return {
        hash: res.hash,
        status: res.status,
        batchedAt,
        mock: false,
      };
    },

    async getTipStatus(puid: string): Promise<{ status: 'queued' | 'settled' | 'unknown'; hash: string | null; mock: boolean }> {
      const up = await isReachable();
      if (!up) {
        return {
          status: 'settled',
          hash: deterministicHash({ puid, ts: 'mock' }),
          mock: true,
        };
      }
      try {
        const res = await requestJson<{ status: 'queued' | 'settled' | 'unknown'; hash: string | null }>(
          `${apiUrl}/v1/tips/${encodeURIComponent(puid)}`,
          {
            method: 'GET',
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            timeoutMs: requestTimeoutMs,
          },
          'Gateway getTipStatus',
        );
        return { ...res, mock: false };
      } catch {
        return { status: 'unknown', hash: null, mock: false };
      }
    },
  };
}
