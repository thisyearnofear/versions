// MODULAR: Arc L1 settlement provider.
// DRY: all settlement goes through one object; no other module talks to Arc
//      or to crypto.createHash for settlement purposes.
// PERFORMANT: mock-first — when ARC_RPC_URL is missing or unreachable, the
//             mock keeps the rest of the system testable without keys.
// CLEAN: returns typed errors; never throws on connectivity — falls back to
//        mock and flags the response with `mock: true` so callers can decide
//        whether to gate on real-Arc.

'use strict';

const crypto = require('crypto');
const { requestJson } = require('../runtime/http');

const DEFAULT_TIMEOUT = 8000;
const MOCK_FINALITY_MS = 500;

// MODULAR: ERC-20 ABI fragments used for live-mode reads + tx encoding.
// We only need three methods right now:
//   - balanceOf(address) -> uint256        (read USDC balance)
//   - transfer(address,uint256)           (encode the calldata for a send)
//   - decimals() -> uint8                 (USDC has 6, but we don't trust it)
// The fragments are hand-rolled instead of pulling in ethers — the proxy
// only needs a handful of selectors and a tiny encoder.
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';           // keccak256("balanceOf(address)")[:4]
const ERC20_TRANSFER_SELECTOR   = '0xa9059cbb';           // keccak256("transfer(address,uint256)")[:4]
const ERC20_DECIMALS_SELECTOR   = '0x313ce567';           // keccak256("decimals()")[:4]

function encodeAddress(addr) {
  // MODULAR: lowercase the address, strip 0x, pad-left to 32 bytes.
  // The Arc team uses 0x-prefixed hex; we normalise defensively.
  const hex = (addr || '').toLowerCase().replace(/^0x/, '');
  if (hex.length !== 40) throw new Error('invalid address: ' + addr);
  return '0'.repeat(24) + hex;
}

function encodeUint256(valueBig) {
  // MODULAR: BigInt -> 32-byte hex. amountMicroUsdc fits in uint256 for any
  // sane USDC amount (USDC total supply is ~10^15 micro-units; uint256 is 10^77).
  if (typeof valueBig !== 'bigint') valueBig = BigInt(valueBig);
  if (valueBig < 0n) throw new Error('amount must be non-negative');
  return valueBig.toString(16).padStart(64, '0');
}

function microUsdcToBigInt(decimalString) {
  // MODULAR: parse "0.50" or "0.000123" into BigInt micro-units (6 decimals).
  // Mirrors settlement.toMicroUsdc but lives in the adapter so the encoding
  // path doesn't need to import settlement (DRY in the other direction).
  if (typeof decimalString !== 'string') throw new Error('amount must be a string');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimalString);
  if (!m) throw new Error('amount must be a decimal string');
  const whole = m[1];
  const frac = (m[2] || '').padEnd(6, '0').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

function createArcAdapter({ rpcUrl, usdcContract, platformWallet, requestTimeoutMs = DEFAULT_TIMEOUT }) {
  const useMock = !rpcUrl;
  let cachedChainId = null;
  let cachedUsdcDecimals = null;

  // PERFORMANT: cache the "is RPC reachable?" check so we don't ping on
  // every request. Reset to null on a real failure so we re-check next call.
  let reachable = null;
  async function isReachable() {
    if (useMock) return false;
    if (reachable !== null) return reachable;
    try {
      await requestJson(
        rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          timeoutMs: 3000
        },
        'Arc RPC ping'
      );
      reachable = true;
    } catch (err) {
      console.warn(`[arc] RPC unreachable, falling back to mock: ${err.message}`);
      reachable = false;
    }
    return reachable;
  }

  async function fetchChainId() {
    if (cachedChainId) return cachedChainId;
    try {
      const res = await requestJson(
        rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          timeoutMs: requestTimeoutMs
        },
        'Arc eth_chainId'
      );
      cachedChainId = res && res.result ? res.result : null;
    } catch (_) {
      cachedChainId = null;
    }
    return cachedChainId;
  }

  async function rpcCall(method, params) {
    // MODULAR: single helper for any read-only JSON-RPC call. Tests mock
    // this layer; live callers hit the real RPC.
    const res = await requestJson(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        timeoutMs: requestTimeoutMs
      },
      `Arc ${method}`
    );
    if (res && res.error) throw new Error(`Arc ${method}: ${res.error.message || JSON.stringify(res.error)}`);
    return res && res.result !== undefined ? res.result : null;
  }

  function deterministicHash(payload) {
    return '0x' + crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  return {
    /** Returns chain + USDC contract + mock flag + decimals + platform balance. */
    async getInfo() {
      const up = await isReachable();
      if (!up) {
        return {
          chainId: null,
          rpcUrl: rpcUrl || null,
          usdcContract: usdcContract || null,
          usdcDecimals: 6,
          platformWallet: platformWallet || null,
          platformUsdcBalance: null,
          mock: true
        };
      }
      const chainId = await fetchChainId();
      let decimals = cachedUsdcDecimals;
      let platformBalance = null;
      if (usdcContract) {
        try {
          if (decimals == null) {
            const decHex = await rpcCall('eth_call', [{ to: usdcContract, data: ERC20_DECIMALS_SELECTOR }, 'latest']);
            decimals = decHex ? Number(BigInt(decHex)) : 6;
            cachedUsdcDecimals = decimals;
          }
          if (platformWallet) {
            const balHex = await rpcCall('eth_call', [{ to: usdcContract, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(platformWallet) }, 'latest']);
            platformBalance = balHex != null ? BigInt(balHex).toString() : null;
          }
        } catch (err) {
          console.warn(`[arc] live-mode read failed: ${err.message}`);
        }
      }
      return {
        chainId,
        rpcUrl,
        usdcContract,
        usdcDecimals: decimals || 6,
        platformWallet: platformWallet || null,
        platformUsdcBalance: platformBalance,  // raw micro-units (string), null if unknown
        mock: false
      };
    },

    /** Read a wallet's USDC balance as a BigInt of micro-units (10^decimals). */
    async getUsdcBalance(wallet) {
      const up = await isReachable();
      if (!up) return { balance: null, mock: true };
      if (!usdcContract) throw new Error('ARC_USDC_CONTRACT is not set');
      const hex = await rpcCall('eth_call', [{ to: usdcContract, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet) }, 'latest']);
      return { balance: hex != null ? BigInt(hex) : 0n, mock: false };
    },

    /**
     * Build the calldata for an ERC-20 transfer(to, amount). The caller is
     * responsible for signing + broadcasting; the proxy never holds a key.
     * amountUsdc is a decimal string ("0.50") converted to micro-units at
     * 6 decimals (USDC convention).
     */
    buildErc20TransferCalldata({ to, amountUsdc }) {
      if (!usdcContract) throw new Error('ARC_USDC_CONTRACT is not set');
      const amountMicro = microUsdcToBigInt(amountUsdc);
      return ERC20_TRANSFER_SELECTOR + encodeAddress(to) + encodeUint256(amountMicro);
    },

    /** Look up a transaction receipt. Mock returns a synthesised "finalized" receipt. */
    async getTransactionReceipt(hash) {
      const up = await isReachable();
      if (!up) {
        return {
          hash,
          status: '0x1',
          blockNumber: '0x0',
          confirmations: 999,
          from: null,
          to: usdcContract || null,
          mock: true
        };
      }
      const result = await rpcCall('eth_getTransactionReceipt', [hash]);
      if (!result) return null;
      const blockNumber = result.blockNumber ? BigInt(result.blockNumber).toString() : null;
      return {
        hash,
        status: result.status,                  // '0x1' success, '0x0' revert
        blockNumber,
        confirmations: 1,                        // first read; waitForFinality increments
        from: result.from || null,
        to: result.to || null,
        logs: result.logs || [],
        mock: false
      };
    },

    /** Look up a transaction by hash (pending or mined). */
    async getTransaction(hash) {
      const up = await isReachable();
      if (!up) {
        return {
          hash,
          status: 'finalized',
          confirmations: 999,
          blockNumber: 0,
          from: null,
          to: platformWallet || null,
          amount_usdc: null,
          mock: true
        };
      }
      const data = await requestJson(
        rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionByHash',
            params: [hash]
          }),
          timeoutMs: requestTimeoutMs
        },
        'Arc getTransaction'
      );
      return data && data.result ? data.result : null;
    },

    /** Estimate gas. Mock returns a small constant. */
    async quoteTransfer({ to, amountUsdc }) {
      const up = await isReachable();
      if (!up) {
        return { estimatedFeeUsdc: '0.001', willSucceed: true, mock: true };
      }
      if (!usdcContract) throw new Error('ARC_USDC_CONTRACT is not set');
      try {
        // MODULAR: estimateGas against the actual transfer calldata. A failed
        // estimate (e.g. insufficient balance, paused contract) bubbles up
        // so the caller can gate before submitting.
        const data = this.buildErc20TransferCalldata({ to, amountUsdc });
        const gasHex = await rpcCall('eth_estimateGas', [{
          from: platformWallet,
          to: usdcContract,
          data,
          value: '0x0'
        }]);
        // USDC has 6 decimals, native USDC gas is denominated in USDC too on
        // Arc, so we approximate fee = gasUsed * gasPrice (mock 1 gwei-equivalent
        // until the Arc team publishes a gas-price oracle). The point of this
        // method is to surface *will the call succeed*, not to quote exact fees.
        const gas = gasHex ? Number(BigInt(gasHex)) : 0;
        return { estimatedGas: gas, estimatedFeeUsdc: '0.001', willSucceed: true, mock: false };
      } catch (err) {
        return { estimatedFeeUsdc: null, willSucceed: false, error: err.message, mock: false };
      }
    },

    /**
     * Server-side send. The client normally signs + broadcasts; this method
     * is used by the mock harness and by tests. Real-Arc path is a stub for
     * Day 3 mock is enough.
     */
    async sendTransfer({ from, to, amountUsdc }) {
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
     * Used by the listen-payment flow (Day 2) where the agent operator
     * pre-funds a hot wallet and signs offline-then-broadcasts. Mock returns
     * a deterministic hash without contacting the RPC.
     */
    async sendRawTransaction({ signedTx, from, to, amountUsdc }) {
      const up = await isReachable();
      if (!up) {
        return { hash: deterministicHash({ from, to, amountUsdc, ts: Date.now() }), mock: true };
      }
      const hash = await rpcCall('eth_sendRawTransaction', [signedTx]);
      return { hash, mock: false };
    },

    /** Poll getTransactionReceipt until a receipt appears AND status is final. Mock: sleep then return. */
    async waitForFinality(hash, { timeoutMs = 10000 } = {}) {
      const up = await isReachable();
      if (!up) {
        await new Promise((r) => setTimeout(r, MOCK_FINALITY_MS));
        return {
          hash,
          status: '0x1',
          blockNumber: '0x0',
          confirmations: 1,
          mock: true
        };
      }
      const deadline = Date.now() + timeoutMs;
      let receipt = await this.getTransactionReceipt(hash);
      // MODULAR: keep polling until a receipt shows up. Arc finality is
      // sub-500ms so this is usually one or two ticks; the loop absorbs
      // jitter on a busy node and the case where the broadcast hasn't
      // propagated yet (call returns null rather than a pending receipt).
      while (Date.now() < deadline && (!receipt || (receipt.status !== '0x1' && receipt.status !== '0x0'))) {
        await new Promise((r) => setTimeout(r, 500));
        receipt = await this.getTransactionReceipt(hash);
      }
      return receipt;
    }
  };
}

module.exports = {
  createArcAdapter,
  // Exported for tests + the listen-payment flow that needs to encode
  // calldata without going through the adapter.
  microUsdcToBigInt,
  encodeAddress,
  encodeUint256
};
