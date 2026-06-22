// MODULAR: Arc L1 settlement provider.
// DRY: all settlement goes through one object; no other module talks to Arc
//      or to crypto.createHash for settlement purposes.
// PERFORMANT: mock-first — when ARC_RPC_URL is missing or unreachable, the
//             mock keeps the rest of the system testable without keys.
// CLEAN: returns typed errors; never throws on connectivity — falls back to
//        mock and flags the response with `mock: true` so callers can decide
//        whether to gate on real-Arc.

import { createHash } from 'crypto';
import { getAddress, isAddress } from 'viem';
import { requestJson } from '../lib/http';

const DEFAULT_TIMEOUT = 8000;
const MOCK_FINALITY_MS = 500;

// MODULAR: ERC-20 ABI fragments used for live-mode reads + tx encoding.
// We only need three methods right now:
//   - balanceOf(address) -> uint256        (read USDC balance)
//   - transfer(address,uint256)           (encode the calldata for a send)
//   - decimals() -> uint8                 (USDC has 6, but we don't trust it)
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231'; // keccak256("balanceOf(address)")[:4]
const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'; // keccak256("transfer(address,uint256)")[:4]
const ERC20_DECIMALS_SELECTOR = '0x313ce567'; // keccak256("decimals()")[:4]

export function encodeAddress(addr: string): string {
  // MODULAR: lowercase the address, strip 0x, pad-left to 32 bytes.
  if (!isAddress(addr)) throw new Error('invalid address: ' + addr);
  return '0'.repeat(24) + getAddress(addr).slice(2).toLowerCase();
}

export function encodeUint256(valueBig: bigint | number): string {
  // MODULAR: BigInt -> 32-byte hex. amountMicroUsdc fits in uint256 for any
  // sane USDC amount (USDC total supply is ~10^15 micro-units; uint256 is 10^77).
  const v = typeof valueBig === 'bigint' ? valueBig : BigInt(valueBig);
  if (v < BigInt(0)) throw new Error('amount must be non-negative');
  return v.toString(16).padStart(64, '0');
}

export function microUsdcToBigInt(decimalString: string): bigint {
  // MODULAR: parse "0.50" or "0.000123" into BigInt micro-units (6 decimals).
  if (typeof decimalString !== 'string') throw new Error('amount must be a string');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimalString);
  if (!m) throw new Error('amount must be a decimal string');
  const whole = m[1];
  const frac = (m[2] || '').padEnd(6, '0').slice(0, 6);
  return BigInt(whole) * BigInt(1000000) + BigInt(frac);
}

export interface ArcInfo {
  chainId: string | null;
  rpcUrl: string | null;
  usdcContract: string | null;
  usdcDecimals: number;
  platformWallet: string | null;
  platformUsdcBalance: string | null;
  mock: boolean;
}

export interface UsdcBalanceResult {
  balance: bigint | null;
  mock: boolean;
}

export interface QuoteResult {
  estimatedGas?: number;
  estimatedFeeUsdc: string | null;
  willSucceed: boolean;
  mock: boolean;
  error?: string;
}

export interface TransferReceipt {
  hash: string;
  status: '0x1' | '0x0' | 'finalized';
  blockNumber: string | null;
  confirmations: number;
  from?: string | null;
  to?: string | null;
  logs?: unknown[];
  mock: boolean;
}

export interface TransferResult {
  hash: string;
  mock: boolean;
}

export interface SendTransferArgs {
  from: string;
  to: string;
  amountUsdc: string;
}

export interface ArcAdapter {
  getInfo: () => Promise<ArcInfo>;
  getUsdcBalance: (wallet: string) => Promise<UsdcBalanceResult>;
  buildErc20TransferCalldata: (args: { to: string; amountUsdc: string }) => string;
  getTransactionReceipt: (hash: string) => Promise<TransferReceipt | null>;
  getTransaction: (hash: string) => Promise<TransferReceipt | null>;
  quoteTransfer: (args: { to: string; amountUsdc: string }) => Promise<QuoteResult>;
  sendTransfer: (args: SendTransferArgs) => Promise<TransferResult>;
  sendRawTransaction: (args: SendTransferArgs & { signedTx: string }) => Promise<TransferResult>;
  waitForFinality: (hash: string, opts?: { timeoutMs?: number }) => Promise<TransferReceipt | null>;
}

export function createArcAdapter({
  rpcUrl,
  usdcContract,
  platformWallet,
  requestTimeoutMs = DEFAULT_TIMEOUT,
}: {
  rpcUrl?: string;
  usdcContract?: string;
  platformWallet?: string;
  requestTimeoutMs?: number;
}): ArcAdapter {
  const useMock = !rpcUrl;
  let cachedChainId: string | null = null;
  let cachedUsdcDecimals: number | null = null;

  // PERFORMANT: cache the "is RPC reachable?" check so we don't ping on
  // every request. Reset to null on a real failure so we re-check next call.
  let reachable: boolean | null = null;
  async function isReachable(): Promise<boolean> {
    if (useMock) return false;
    if (reachable !== null) return reachable;
    try {
      await requestJson<{ result?: string }>(
        rpcUrl!,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          timeoutMs: 3000,
        },
        'Arc RPC ping',
      );
      reachable = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[arc] RPC unreachable, falling back to mock: ${msg}`);
      reachable = false;
    }
    return reachable;
  }

  async function fetchChainId(): Promise<string | null> {
    if (cachedChainId) return cachedChainId;
    try {
      const res = await requestJson<{ result?: string }>(
        rpcUrl!,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          timeoutMs: requestTimeoutMs,
        },
        'Arc eth_chainId',
      );
      cachedChainId = res && res.result ? res.result : null;
    } catch {
      cachedChainId = null;
    }
    return cachedChainId;
  }

  async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
    // MODULAR: single helper for any read-only JSON-RPC call.
    const res = await requestJson<{ result?: unknown; error?: { message?: string } }>(
      rpcUrl!,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        timeoutMs: requestTimeoutMs,
      },
      `Arc ${method}`,
    );
    if (res && res.error) throw new Error(`Arc ${method}: ${res.error.message || JSON.stringify(res.error)}`);
    return res && res.result !== undefined ? res.result : null;
  }

  function deterministicHash(payload: Record<string, unknown>): string {
    return '0x' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  return {
    /** Returns chain + USDC contract + mock flag + decimals + platform balance. */
    async getInfo(): Promise<ArcInfo> {
      const up = await isReachable();
      if (!up) {
        return {
          chainId: null,
          rpcUrl: rpcUrl || null,
          usdcContract: usdcContract || null,
          usdcDecimals: 6,
          platformWallet: platformWallet || null,
          platformUsdcBalance: null,
          mock: true,
        };
      }
      const chainId = await fetchChainId();
      let decimals = cachedUsdcDecimals;
      let platformBalance: string | null = null;
      if (usdcContract) {
        try {
          if (decimals == null) {
            const decHex = (await rpcCall('eth_call', [
              { to: usdcContract, data: ERC20_DECIMALS_SELECTOR },
              'latest',
            ])) as string | null;
            decimals = decHex ? Number(BigInt(decHex)) : 6;
            cachedUsdcDecimals = decimals;
          }
          if (platformWallet) {
            const balHex = (await rpcCall('eth_call', [
              { to: usdcContract, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(platformWallet) },
              'latest',
            ])) as string | null;
            platformBalance = balHex != null ? BigInt(balHex).toString() : null;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[arc] live-mode read failed: ${msg}`);
        }
      }
      return {
        chainId,
        rpcUrl: rpcUrl || null,
        usdcContract: usdcContract || null,
        usdcDecimals: decimals || 6,
        platformWallet: platformWallet || null,
        platformUsdcBalance: platformBalance,
        mock: false,
      };
    },

    /** Read a wallet's USDC balance as a BigInt of micro-units (10^decimals). */
    async getUsdcBalance(wallet: string): Promise<UsdcBalanceResult> {
      const up = await isReachable();
      if (!up) return { balance: null, mock: true };
      if (!usdcContract) throw new Error('ARC_USDC_CONTRACT is not set');
      const hex = (await rpcCall('eth_call', [
        { to: usdcContract, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet) },
        'latest',
      ])) as string | null;
      return { balance: hex != null ? BigInt(hex) : BigInt(0), mock: false };
    },

    /**
     * Build the calldata for an ERC-20 transfer(to, amount). The caller is
     * responsible for signing + broadcasting; the proxy never holds a key.
     */
    buildErc20TransferCalldata({ to, amountUsdc }: { to: string; amountUsdc: string }): string {
      if (!usdcContract) throw new Error('ARC_USDC_CONTRACT is not set');
      const amountMicro = microUsdcToBigInt(amountUsdc);
      return ERC20_TRANSFER_SELECTOR + encodeAddress(to) + encodeUint256(amountMicro);
    },

    /** Look up a transaction receipt. Mock returns a synthesised "finalized" receipt. */
    async getTransactionReceipt(hash: string): Promise<TransferReceipt | null> {
      const up = await isReachable();
      if (!up) {
        return {
          hash,
          status: '0x1',
          blockNumber: '0x0',
          confirmations: 999,
          from: null,
          to: usdcContract || null,
          mock: true,
        };
      }
      const result = (await rpcCall('eth_getTransactionReceipt', [hash])) as
        | {
            status?: '0x1' | '0x0';
            blockNumber?: string;
            from?: string;
            to?: string;
            logs?: unknown[];
          }
        | null;
      if (!result) return null;
      const blockNumber = result.blockNumber ? BigInt(result.blockNumber).toString() : null;
      return {
        hash,
        status: result.status || '0x1',
        blockNumber,
        confirmations: 1,
        from: result.from || null,
        to: result.to || null,
        logs: result.logs || [],
        mock: false,
      };
    },

    /** Look up a transaction by hash (pending or mined). */
    async getTransaction(hash: string): Promise<TransferReceipt | null> {
      const up = await isReachable();
      if (!up) {
        return {
          hash,
          status: 'finalized',
          confirmations: 999,
          blockNumber: '0',
          from: null,
          to: platformWallet || null,
          mock: true,
        };
      }
      const data = await requestJson<{ result?: { from?: string; to?: string; blockNumber?: string } | null }>(
        rpcUrl!,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionByHash',
            params: [hash],
          }),
          timeoutMs: requestTimeoutMs,
        },
        'Arc getTransaction',
      );
      const result = data && data.result;
      if (!result) return null;
      return {
        hash,
        status: 'finalized',
        confirmations: 1,
        blockNumber: result.blockNumber ? BigInt(result.blockNumber).toString() : null,
        from: result.from || null,
        to: result.to || null,
        mock: false,
      };
    },

    /** Estimate gas. Mock returns a small constant. */
    async quoteTransfer({ to, amountUsdc }: { to: string; amountUsdc: string }): Promise<QuoteResult> {
      const up = await isReachable();
      if (!up) {
        return { estimatedFeeUsdc: '0.001', willSucceed: true, mock: true };
      }
      if (!usdcContract) throw new Error('ARC_USDC_CONTRACT is not set');
      try {
        const data = this.buildErc20TransferCalldata({ to, amountUsdc });
        const gasHex = (await rpcCall('eth_estimateGas', [
          {
            from: platformWallet,
            to: usdcContract,
            data,
            value: '0x0',
          },
        ])) as string | null;
        const gas = gasHex ? Number(BigInt(gasHex)) : 0;
        return { estimatedGas: gas, estimatedFeeUsdc: '0.001', willSucceed: true, mock: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { estimatedFeeUsdc: null, willSucceed: false, error: msg, mock: false };
      }
    },

    /**
     * Server-side send. The client normally signs + broadcasts; this method
     * is used by the mock harness and by tests.
     */
    async sendTransfer({ from, to, amountUsdc }: SendTransferArgs): Promise<TransferResult> {
      const up = await isReachable();
      const hash = deterministicHash({ from, to, amountUsdc, ts: Date.now() });
      if (!up) {
        return { hash, mock: true };
      }
      // Real-Arc broadcast belongs on the client. Server-side send is only
      // useful for the mock harness; emit a structured error in real mode.
      throw new Error('server-side sendTransfer is mock-only; client must broadcast on Arc');
    },

    /**
     * Broadcast a pre-signed raw transaction. Returns { hash } on success.
     */
    async sendRawTransaction({
      signedTx,
      from,
      to,
      amountUsdc,
    }: SendTransferArgs & { signedTx: string }): Promise<TransferResult> {
      const up = await isReachable();
      if (!up) {
        return { hash: deterministicHash({ from, to, amountUsdc, ts: Date.now() }), mock: true };
      }
      const hash = (await rpcCall('eth_sendRawTransaction', [signedTx])) as string;
      return { hash, mock: false };
    },

    /** Poll getTransactionReceipt until a receipt appears AND status is final. Mock: sleep then return. */
    async waitForFinality(hash: string, { timeoutMs = 10000 } = {}): Promise<TransferReceipt | null> {
      const up = await isReachable();
      if (!up) {
        await new Promise((r) => setTimeout(r, MOCK_FINALITY_MS));
        return {
          hash,
          status: '0x1',
          blockNumber: '0x0',
          confirmations: 1,
          mock: true,
        };
      }
      const deadline = Date.now() + timeoutMs;
      let receipt = await this.getTransactionReceipt(hash);
      while (
        Date.now() < deadline &&
        (!receipt || (receipt.status !== '0x1' && receipt.status !== '0x0'))
      ) {
        await new Promise((r) => setTimeout(r, 500));
        receipt = await this.getTransactionReceipt(hash);
      }
      return receipt;
    },
  };
}
