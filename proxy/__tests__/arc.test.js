// MODULAR: arc adapter tests. Covers:
//   - mock-first fallback when no rpcUrl
//   - live-mode info reads (chainId, decimals, platform balance)
//   - live-mode calldata encoding (transfer, balanceOf)
//   - live-mode waitForFinality polling the receipt
// HTTP layer is stubbed via the runtime/http module — no real RPC is hit.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createArcAdapter, microUsdcToBigInt, encodeAddress, encodeUint256 } = require('../adapters/arc');

// MODULAR: stub the HTTP layer so we can drive the live-mode paths without
// a real RPC. Each test sets the responses it expects; unhandled URLs fail.
function stubHttp(responses) {
  // responses: { 'eth_chainId': '0x4cef52', 'eth_call': '0x...', ... }
  // The stub matches by JSON-RPC method name.
  return {
    async requestJson(url, opts, label) {
      const body = JSON.parse(opts.body);
      const method = body.method;
      if (!(method in responses)) {
        throw new Error('stub-http: no response configured for ' + method);
      }
      const value = responses[method];
      if (value instanceof Error) throw value;
      return { jsonrpc: '2.0', id: 1, result: value };
    }
  };
}

// We can't easily monkey-patch the adapter's internal `requestJson`
// binding, so we point it at a local server. The local server replays
// the canned responses keyed by JSON-RPC method.
const http = require('http');
const crypto = require('crypto');

function startStubServer(responses) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch (_) { parsed = {}; }
        const method = parsed.method || '';
        const value = responses[method];
        if (value === undefined) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method ' + method + ' not stubbed' } }));
          return;
        }
        if (value instanceof Error) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: value.message } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: value }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ url: 'http://127.0.0.1:' + port, close: () => server.close() });
    });
  });
}

test('mock-first: no rpcUrl means all calls return mock results', async () => {
  const arc = createArcAdapter({
    rpcUrl: null,
    usdcContract: null,
    platformWallet: null
  });
  const info = await arc.getInfo();
  assert.equal(info.mock, true);
  assert.equal(info.chainId, null);
  assert.equal(info.platformUsdcBalance, null);
  assert.equal(info.usdcDecimals, 6);

  const hash = '0xabc';
  const tx = await arc.getTransaction(hash);
  assert.equal(tx.mock, true);
  assert.equal(tx.status, 'finalized');

  const final = await arc.waitForFinality(hash);
  assert.equal(final.mock, true);
  assert.equal(final.status, '0x1');

  const send = await arc.sendTransfer({ from: '0xa', to: '0xb', amountUsdc: '0.50' });
  assert.equal(send.mock, true);
  assert.match(send.hash, /^0x[0-9a-f]{64}$/);
});

test('live-mode: getInfo returns chainId + decimals + platform balance', async () => {
  // MODULAR: stub distinguishes between decimals() and balanceOf() by the
  // first 4 bytes of the call data. decimals returns 6; balanceOf returns
  // 100 USDC = 100_000_000 micro-units.
  const DECIMALS_HEX = '0x' + (6n).toString(16).padStart(64, '0');
  const BALANCE_HEX  = '0x' + (100_000_000n).toString(16).padStart(64, '0');
  const stub = await startStubServer({
    eth_chainId: '0x4cef52',
    eth_call: null  // dispatched dynamically below
  });
  // Replace the inner handler with one that reads parsed.data[0..10].
  // startStubServer already wired the dispatcher; we just need to inspect
  // the calldata selector. Easier: spin up a custom server here.
  stub.close();
  const custom = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const method = parsed.method;
      if (method === 'eth_chainId') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x4cef52' }));
        return;
      }
      if (method === 'eth_call') {
        const data = parsed.params[0].data || '';
        const selector = data.slice(0, 10).toLowerCase();
        if (selector === '0x313ce567') {  // decimals()
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: DECIMALS_HEX }));
        } else if (selector === '0x70a08231') {  // balanceOf(address)
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: BALANCE_HEX }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no stub for selector ' + selector } }));
        }
        return;
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no stub for ' + method } }));
    });
  });
  await new Promise((r) => custom.listen(0, '127.0.0.1', r));
  const port = custom.address().port;
  try {
    const arc = createArcAdapter({
      rpcUrl: 'http://127.0.0.1:' + port,
      usdcContract: '0x' + 'aa'.repeat(20),
      platformWallet: '0x' + '11'.repeat(20),
      requestTimeoutMs: 2000
    });
    const info = await arc.getInfo();
    assert.equal(info.mock, false);
    assert.equal(info.chainId, '0x4cef52');
    assert.equal(info.usdcDecimals, 6);
    assert.equal(info.platformUsdcBalance, (100_000_000n).toString());
  } finally {
    custom.close();
  }
});

test('live-mode: buildErc20TransferCalldata produces correct selector + padded args', () => {
  const arc = createArcAdapter({
    rpcUrl: null,
    usdcContract: '0x' + 'aa'.repeat(20),
    platformWallet: null
  });
  const data = arc.buildErc20TransferCalldata({ to: '0x' + 'bb'.repeat(20), amountUsdc: '0.50' });
  // selector (4 bytes) + address (32 bytes) + amount (32 bytes) = 68 bytes = 136 hex chars + 0x
  assert.equal(data.length, 2 + 8 + 64 + 64);
  assert.equal(data.slice(0, 10), '0xa9059cbb');
  // address is left-padded with zeros
  assert.equal(data.slice(10, 74), '0'.repeat(24) + 'bb'.repeat(20));
  // 0.50 USDC = 500_000 micro-units
  assert.equal(data.slice(74), (500_000n).toString(16).padStart(64, '0'));
});

test('live-mode: buildErc20TransferCalldata handles sub-cent amounts', () => {
  const arc = createArcAdapter({
    rpcUrl: null,
    usdcContract: '0x' + 'aa'.repeat(20),
    platformWallet: null
  });
  // $0.000123 = 123 micro-units
  const data = arc.buildErc20TransferCalldata({ to: '0x' + 'cc'.repeat(20), amountUsdc: '0.000123' });
  assert.equal(data.slice(74), (123n).toString(16).padStart(64, '0'));
});

test('live-mode: buildErc20TransferCalldata rejects invalid addresses', () => {
  const arc = createArcAdapter({
    rpcUrl: null,
    usdcContract: '0x' + 'aa'.repeat(20),
    platformWallet: null
  });
  assert.throws(() => arc.buildErc20TransferCalldata({ to: 'not-an-address', amountUsdc: '0.50' }), /invalid address/);
});

test('live-mode: quoteTransfer surfaces willSucceed=false on estimateGas failure', async () => {
  const stub = await startStubServer({
    eth_chainId: '0x4cef52',
    eth_estimateGas: new Error('insufficient balance')
  });
  try {
    const arc = createArcAdapter({
      rpcUrl: stub.url,
      usdcContract: '0x' + 'aa'.repeat(20),
      platformWallet: '0x' + '11'.repeat(20),
      requestTimeoutMs: 2000
    });
    const q = await arc.quoteTransfer({ to: '0x' + 'bb'.repeat(20), amountUsdc: '0.50' });
    assert.equal(q.mock, false);
    assert.equal(q.willSucceed, false);
    assert.match(q.error, /insufficient balance/);
  } finally {
    stub.close();
  }
});

test('live-mode: waitForFinality returns receipt once status is 0x1', async () => {
  let callCount = 0;
  const stub = await startStubServer({});  // dynamic dispatch below
  // We need a custom server for this case because the receipt endpoint is
  // called repeatedly with different responses.
  const custom = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const method = parsed.method;
      if (method === 'eth_chainId') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x4cef52' }));
      } else if (method === 'eth_getTransactionReceipt') {
        callCount++;
        // First call: pending (no receipt). Second call: mined.
        if (callCount === 1) {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
        } else {
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: 1,
            result: {
              transactionHash: '0xabc',
              status: '0x1',
              blockNumber: '0x10',
              from: '0x' + '11'.repeat(20),
              to: '0x' + 'aa'.repeat(20),
              logs: []
            }
          }));
        }
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no stub' } }));
      }
    });
  });
  stub.close();  // unused
  await new Promise((r) => custom.listen(0, '127.0.0.1', r));
  const port = custom.address().port;
  try {
    const arc = createArcAdapter({
      rpcUrl: 'http://127.0.0.1:' + port,
      usdcContract: '0x' + 'aa'.repeat(20),
      platformWallet: '0x' + '11'.repeat(20),
      requestTimeoutMs: 2000
    });
    const r = await arc.waitForFinality('0xabc', { timeoutMs: 5000 });
    assert.equal(r.status, '0x1');
    assert.equal(callCount, 2);
  } finally {
    custom.close();
  }
});

test('microUsdcToBigInt: parses decimal strings correctly', () => {
  assert.equal(microUsdcToBigInt('0.50'), 500_000n);
  assert.equal(microUsdcToBigInt('1'), 1_000_000n);
  assert.equal(microUsdcToBigInt('0.000001'), 1n);  // the floor
  assert.equal(microUsdcToBigInt('0.0000001'), 0n); // sub-micro rounded down
  assert.throws(() => microUsdcToBigInt('abc'), /decimal/);
  assert.throws(() => microUsdcToBigInt(null), /string/);
});

test('encodeAddress: pads left to 32 bytes, lowercases', () => {
  assert.equal(encodeAddress('0x' + 'AB'.repeat(20)).length, 64);
  assert.equal(encodeAddress('0x' + 'AB'.repeat(20)), '0'.repeat(24) + 'ab'.repeat(20));
  assert.throws(() => encodeAddress('0x1234'), /invalid/);
});

test('encodeUint256: BigInt -> 32-byte hex', () => {
  assert.equal(encodeUint256(0n).length, 64);
  assert.equal(encodeUint256(1n), '0'.repeat(63) + '1');
  assert.equal(encodeUint256((1n << 256n) - 1n), 'f'.repeat(64));
});
