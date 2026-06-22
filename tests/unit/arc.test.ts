// MODULAR: arc adapter tests. No DB. HTTP layer is exercised via a stub server
// when the adapter is in live mode.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import {
  createArcAdapter,
  encodeAddress,
  encodeUint256,
  microUsdcToBigInt,
} from '../../src/adapters/arc';

function startStubServer(handler: (parsed: { method: string; params: unknown[] }) => unknown): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsed: { method: string; params: unknown[] };
        try {
          parsed = JSON.parse(body);
        } catch {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'bad json' } }));
          return;
        }
        try {
          const result = handler(parsed);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: msg } }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('arc: mock-first (no rpcUrl)', () => {
  it('getInfo returns mock', async () => {
    const arc = createArcAdapter({});
    const info = await arc.getInfo();
    expect(info.mock).toBe(true);
    expect(info.chainId).toBeNull();
    expect(info.platformUsdcBalance).toBeNull();
    expect(info.usdcDecimals).toBe(6);
  });

  it('getTransaction returns mock', async () => {
    const arc = createArcAdapter({});
    const tx = await arc.getTransaction('0xabc');
    expect(tx?.mock).toBe(true);
    expect(tx?.status).toBe('finalized');
  });

  it('waitForFinality returns mock', async () => {
    const arc = createArcAdapter({});
    const r = await arc.waitForFinality('0xabc');
    expect(r?.mock).toBe(true);
    expect(r?.status).toBe('0x1');
  });

  it('sendTransfer returns deterministic mock hash', async () => {
    const arc = createArcAdapter({});
    const r = await arc.sendTransfer({ from: '0xa', to: '0xb', amountUsdc: '0.50' });
    expect(r.mock).toBe(true);
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('arc: live mode via stub server', () => {
  let stub: { url: string; close: () => Promise<void> };
  let callCount = 0;

  beforeAll(async () => {
    stub = await startStubServer((parsed) => {
      if (parsed.method === 'eth_chainId') return '0x4cef52';
      if (parsed.method === 'eth_call') {
        const params = parsed.params as Array<{ data?: string }>;
        const data = params[0]?.data || '';
        const selector = data.slice(0, 10).toLowerCase();
        if (selector === '0x313ce567') return '0x' + (6n).toString(16).padStart(64, '0');
        if (selector === '0x70a08231') return '0x' + (100_000_000n).toString(16).padStart(64, '0');
        return null;
      }
      if (parsed.method === 'eth_estimateGas') return '0x5208';
      if (parsed.method === 'eth_getTransactionReceipt') {
        callCount++;
        if (callCount === 1) return null;
        return {
          transactionHash: '0xabc',
          status: '0x1',
          blockNumber: '0x10',
          from: '0x' + '11'.repeat(20),
          to: '0x' + 'aa'.repeat(20),
          logs: [],
        };
      }
      if (parsed.method === 'eth_sendRawTransaction') return '0x' + 'd'.repeat(64);
      return null;
    });
  });

  afterAll(async () => {
    await stub.close();
  });

  it('getInfo returns chainId + decimals + platform balance', async () => {
    const arc = createArcAdapter({
      rpcUrl: stub.url,
      usdcContract: '0x' + 'aa'.repeat(20),
      platformWallet: '0x' + '11'.repeat(20),
      requestTimeoutMs: 2000,
    });
    const info = await arc.getInfo();
    expect(info.mock).toBe(false);
    expect(info.chainId).toBe('0x4cef52');
    expect(info.usdcDecimals).toBe(6);
    expect(info.platformUsdcBalance).toBe('100000000');
  });

  it('buildErc20TransferCalldata produces correct selector + padded args', () => {
    const arc = createArcAdapter({
      rpcUrl: stub.url,
      usdcContract: '0x' + 'aa'.repeat(20),
      platformWallet: '0x' + '11'.repeat(20),
    });
    const data = arc.buildErc20TransferCalldata({
      to: '0x' + 'bb'.repeat(20),
      amountUsdc: '0.50',
    });
    expect(data.length).toBe(2 + 8 + 64 + 64);
    expect(data.slice(0, 10)).toBe('0xa9059cbb');
    expect(data.slice(10, 74)).toBe('0'.repeat(24) + 'bb'.repeat(20));
    expect(data.slice(74)).toBe((500_000n).toString(16).padStart(64, '0'));
  });

  it('buildErc20TransferCalldata handles sub-cent amounts', () => {
    const arc = createArcAdapter({
      usdcContract: '0x' + 'aa'.repeat(20),
    });
    const data = arc.buildErc20TransferCalldata({
      to: '0x' + 'cc'.repeat(20),
      amountUsdc: '0.000123',
    });
    expect(data.slice(74)).toBe((123n).toString(16).padStart(64, '0'));
  });

  it('buildErc20TransferCalldata rejects invalid addresses', () => {
    const arc = createArcAdapter({ usdcContract: '0x' + 'aa'.repeat(20) });
    expect(() =>
      arc.buildErc20TransferCalldata({ to: 'not-an-address', amountUsdc: '0.50' }),
    ).toThrow(/invalid address/);
  });

  it('quoteTransfer returns willSucceed=true on success', async () => {
    const arc = createArcAdapter({
      rpcUrl: stub.url,
      usdcContract: '0x' + 'aa'.repeat(20),
      platformWallet: '0x' + '11'.repeat(20),
      requestTimeoutMs: 2000,
    });
    const q = await arc.quoteTransfer({ to: '0x' + 'bb'.repeat(20), amountUsdc: '0.50' });
    expect(q.willSucceed).toBe(true);
  });
});

describe('microUsdcToBigInt', () => {
  it('parses decimal strings correctly', () => {
    expect(microUsdcToBigInt('0.50')).toBe(500_000n);
    expect(microUsdcToBigInt('1')).toBe(1_000_000n);
    expect(microUsdcToBigInt('0.000001')).toBe(1n);
    expect(microUsdcToBigInt('0.0000001')).toBe(0n);
  });

  it('throws on non-decimal input', () => {
    expect(() => microUsdcToBigInt('abc')).toThrow(/decimal/);
    // @ts-expect-error testing runtime guard
    expect(() => microUsdcToBigInt(null)).toThrow(/string/);
  });
});

describe('encodeAddress', () => {
  it('pads left to 32 bytes and lowercases', () => {
    const { getAddress } = require('viem');
    const checksummed = getAddress('0x' + 'ab'.repeat(20));
    expect(encodeAddress(checksummed).length).toBe(64);
    expect(encodeAddress(checksummed)).toBe('0'.repeat(24) + 'ab'.repeat(20));
  });

  it('throws on invalid addresses', () => {
    expect(() => encodeAddress('0x1234')).toThrow(/invalid/);
  });
});

describe('encodeUint256', () => {
  it('BigInt -> 32-byte hex', () => {
    expect(encodeUint256(0n).length).toBe(64);
    expect(encodeUint256(1n)).toBe('0'.repeat(63) + '1');
    expect(encodeUint256((1n << 256n) - 1n)).toBe('f'.repeat(64));
  });

  it('rejects negative numbers', () => {
    expect(() => encodeUint256(-1)).toThrow(/non-negative/);
  });
});
