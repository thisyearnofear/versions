// MODULAR: x402 nanopayment tests. Covers the EIP-712 verify path
// with a real viem test wallet (not a mock signature), the amount
// helpers, the Gateway adapter in mock mode, and the route handler
// (402 on no header, 200 on valid proof, 401 on bad signature,
// 409 on duplicate puid).

import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { initTestDb, getTestDb, resetTestDb, closeTestDb } from '../helpers/db';

vi.mock('@/lib/db', () => ({
  get db() { return getTestDb(); },
}));

// Mock the event-bus so the route's emit() call doesn't try to
// reach a non-existent SSE handler in the test process.
vi.mock('@/lib/event-bus', () => ({
  emit: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  clearSubscriptions: vi.fn(),
}));

// Mock the services registry so the route can resolve gateway
// + arc + config without touching real adapters.
const mockGateway = {
  getInfo: vi.fn(async () => ({
    apiUrl: null,
    network: 'arc-testnet' as const,
    usdcContract: null,
    batchIntervalMs: 500,
    mock: true,
  })),
  submitTip: vi.fn(async (args: { from: string; to: string; amountUsdc: string; puid: string; message?: string }) => ({
    hash: '0xmockhash_' + args.puid.slice(0, 8),
    status: 'settled' as const,
    batchedAt: new Date().toISOString(),
    mock: true,
  })),
  getTipStatus: vi.fn(async (puid: string) => ({
    status: 'settled' as const,
    hash: '0xmockhash_' + puid.slice(0, 8),
    mock: true,
  })),
};

const mockArc = {
  getInfo: vi.fn(async () => ({
    chainId: '0x4d2', // Arc testnet placeholder
    rpcUrl: null,
    usdcContract: null,
    usdcDecimals: 6,
    platformWallet: '0x000000000000000000000000000000000000d3ad',
    platformUsdcBalance: null,
    mock: true,
  })),
  // unused in the route
  getUsdcBalance: vi.fn(),
  buildErc20TransferCalldata: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  quoteTransfer: vi.fn(),
  sendTransfer: vi.fn(),
  sendRawTransaction: vi.fn(),
  waitForFinality: vi.fn(),
};

vi.mock('@/lib/services', () => ({
  services: () => ({
    gateway: mockGateway,
    arc: mockArc,
    config: { platformWallet: '0x000000000000000000000000000000000000d3ad' },
  }),
  requestIdFor: (req: { headers: { get: (k: string) => string | null } }) =>
    req.headers.get('x-request-id') ?? 'test-rid',
  corsPreflight: () => new Response(null, { status: 204 }),
  jsonResponse: (status: number, body: unknown, rid: string, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'x-request-id': rid, ...extra },
    }),
  errorResponse: (rid: string, status: number, code: string, message: string) =>
    new Response(JSON.stringify({ success: false, error: { code, message } }), {
      status,
      headers: { 'Content-Type': 'application/json', 'x-request-id': rid },
    }),
}));

import {
  X402_VERSION,
  X402_SCHEME,
  X402_NETWORK,
  X402_ASSET,
  buildDomain,
  encodeHeader,
  decodeHeader,
  verifyProof,
  offerMatches,
  parseAmountToMicroUsdc,
  formatMicroUsdc,
  hashOffer,
  type X402Offer,
} from '../../src/lib/x402';
import { createGatewayAdapter } from '../../src/adapters/gateway';
import { POST as tipRoute } from '../../src/app/api/x402/tip/route';
import { x402Proofs } from '../../src/lib/schema';
import { eq } from 'drizzle-orm';

// ── x402 module tests ─────────────────────────────────

describe('x402 module', () => {
  it('parseAmountToMicroUsdc handles sub-cent values down to 1 lepton', () => {
    expect(parseAmountToMicroUsdc('0.000001').toString()).toBe('1');
    expect(parseAmountToMicroUsdc('0.0001').toString()).toBe('100');
    expect(parseAmountToMicroUsdc('0.01').toString()).toBe('10000');
    expect(parseAmountToMicroUsdc('0.10').toString()).toBe('100000');
    expect(parseAmountToMicroUsdc('1').toString()).toBe('1000000');
    expect(parseAmountToMicroUsdc('1.5').toString()).toBe('1500000');
  });

  it('parseAmountToMicroUsdc throws on bad input', () => {
    expect(() => parseAmountToMicroUsdc('abc')).toThrow();
    expect(() => parseAmountToMicroUsdc('-1')).toThrow();
  });

  it('formatMicroUsdc round-trips parseAmountToMicroUsdc (canonical: strips trailing zeros)', () => {
    // MODULAR: formatMicroUsdc normalizes to the shortest decimal
    // form (e.g. '0.10' -> '0.1'). The original user-supplied
    // amountUsdc travels separately in the API body, so the toast
    // can still display 'tipped $0.10' even when the canonical
    // micro-units form is '0.1'.
    // Demonstrating the canonical-strip behavior explicitly:
    expect(formatMicroUsdc(parseAmountToMicroUsdc('0.10'))).toBe('0.1');
    expect(formatMicroUsdc(100000n)).toBe('0.1'); // 100000 micro-USDC (1 dime) — canonical strips trailing zero
    const cases = ['0.000001', '0.0001', '0.01', '0.1', '1', '1.5'];
    for (const c of cases) {
      expect(formatMicroUsdc(parseAmountToMicroUsdc(c))).toBe(c);
    }
  });

  it('buildDomain returns a TypedDataDomain with the correct shape', () => {
    const d = buildDomain(1234);
    expect(d).toEqual({ name: 'VERSIONS x402', version: X402_VERSION, chainId: 1234 });
  });

  it('encodeHeader / decodeHeader round-trips a challenge', () => {
    const offer: X402Offer = {
      resourceUrl: '/api/x402/tip',
      scheme: X402_SCHEME,
      network: X402_NETWORK,
      asset: X402_ASSET,
      payTo: '0x000000000000000000000000000000000000d3ad',
      amount: '100',
      validUntil: Math.floor(Date.now() / 1000) + 300,
      puid: 'test-puid-1234',
    };
    const b64 = encodeHeader(offer);
    expect(typeof b64).toBe('string');
    const decoded = decodeHeader<X402Offer>(b64);
    expect(decoded).toEqual(offer);
  });

  it('offerMatches returns true for identical offers', () => {
    const o: X402Offer = {
      resourceUrl: '/api/x402/tip',
      scheme: X402_SCHEME,
      network: X402_NETWORK,
      asset: X402_ASSET,
      payTo: '0x000000000000000000000000000000000000d3ad',
      amount: '100',
      validUntil: 1,
      puid: 'p',
    };
    expect(offerMatches({ expected: o, submitted: o })).toBe(true);
  });

  it('offerMatches returns false on amount mismatch', () => {
    const a: X402Offer = {
      resourceUrl: '/x', scheme: X402_SCHEME, network: X402_NETWORK, asset: X402_ASSET,
      payTo: '0x000000000000000000000000000000000000d3ad', amount: '100', validUntil: 1, puid: 'p',
    };
    const b = { ...a, amount: '200' };
    expect(offerMatches({ expected: a, submitted: b })).toBe(false);
  });

  it('verifyProof recovers the correct signer (real viem signature)', async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const domain = buildDomain(1234);
    const offer: X402Offer = {
      resourceUrl: '/api/x402/tip',
      scheme: X402_SCHEME,
      network: X402_NETWORK,
      asset: X402_ASSET,
      payTo: '0x000000000000000000000000000000000000d3ad',
      amount: '1',
      validUntil: Math.floor(Date.now() / 1000) + 300,
      puid: 'verify-test',
    };
    const signature = await account.signTypedData({
      domain,
      types: {
        Offer: [
          { name: 'resourceUrl', type: 'string' },
          { name: 'scheme', type: 'string' },
          { name: 'network', type: 'string' },
          { name: 'asset', type: 'string' },
          { name: 'payTo', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'puid', type: 'string' },
        ],
      },
      primaryType: 'Offer',
      message: offer,
    });
    const recovered = await verifyProof({ domain, offer, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

    // MODULAR: a tampered signature must NOT recover the original
    // address. Flip a hex char and confirm verification fails.
    const tampered = ('0x' + (signature.slice(2).split('').reverse().join(''))) as `0x${string}`;
    await expect(verifyProof({ domain, offer, signature: tampered })).rejects.toBeDefined();

    // hashOffer should be deterministic
    const h1 = hashOffer(domain, offer);
    const h2 = hashOffer(domain, offer);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ── x402 module edge cases ─────────────────────────────

// MODULAR: pin the API-boundary contracts that the route handler
// relies on. viem guarantees the cryptographic pieces; this block
// pins what WE own — the regex, the canonical string formatting,
// the case-insensitive payTo comparison, and the BigInt(uint256)
// boundary conversion inside hashOffer.
describe('x402 module edge cases', () => {
  it('parseAmountToMicroUsdc: leading dot ".5", trailing dot "1.", zero "0", throws on empty ""', () => {
    // MODULAR: the regex ^\d+(\.\d+)?$ is intentionally strict —
    // requires a leading digit + optional trailing-digit fractional
    // part. We pin the boundaries so a future regex relaxation
    // never lands silently in production.
    expect(parseAmountToMicroUsdc('0').toString()).toBe('0');
    expect(() => parseAmountToMicroUsdc('')).toThrow();
    expect(() => parseAmountToMicroUsdc('.5')).toThrow();
    expect(() => parseAmountToMicroUsdc('1.')).toThrow();
  });

  it('formatMicroUsdc: 0n renders exactly "0" (not "" or "0.000000")', () => {
    // MODULAR: the canonical-string-strip logic must NOT collapse
    // zero to empty. Pinning here so a future refactor that drops
    // the truthy-fallback (`frac === '0' ? whole : ...`) is caught
    // before any user-facing code (`fmtLeptons`, TipButton toast).
    expect(formatMicroUsdc(0n)).toBe('0');
  });

  it('decodeHeader: invalid base64 string throws on the Buffer decode step', () => {
    // MODULAR: pinning the throw here means the route's
    // decodeHeader<X402Offer>(headers.get('x')) call MUST be
    // guarded — an uncaught throw would surface as 500 instead of
    // a structured 400 to the client.
    expect(() => decodeHeader('!@#$%^&*')).toThrow();
  });

  it('decodeHeader: malformed JSON inside otherwise-valid base64 throws on JSON.parse', () => {
    // MODULAR: same contract as the invalid-base64 test — the
    // route must catch JSON.parse errors and surface 400, not 500.
    const bad = Buffer.from('{ "this is not": valid json', 'utf8').toString('base64');
    expect(() => decodeHeader(bad)).toThrow();
  });

  it('offerMatches: payTo is case-insensitive (uppercase vs lowercase)', () => {
    // MODULAR: pin the explicit toLowerCase() comparison — viem's
    // getAddress would normalize, but offerMatches operates on the
    // raw wire strings, so the route MUST lowercase before
    // comparing or it will fail-equivalent offers.
    const upper: X402Offer = {
      resourceUrl: '/x', scheme: X402_SCHEME, network: X402_NETWORK, asset: X402_ASSET,
      payTo: '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD', amount: '1', validUntil: 1, puid: 'p',
    };
    const lower = { ...upper, payTo: upper.payTo.toLowerCase() };
    expect(offerMatches({ expected: upper, submitted: lower })).toBe(true);
  });

  it('offerMatches: single-field drift on puid returns false', () => {
    // MODULAR: cover one representative single-field drift — the
    // full 7-field cartesian is bloat; viem's getAddress
    // comparison via case-insensitivity is pinned above; this
    // test pins the "any one field drifts → false" contract.
    const base: X402Offer = {
      resourceUrl: '/x', scheme: X402_SCHEME, network: X402_NETWORK, asset: X402_ASSET,
      payTo: '0x000000000000000000000000000000000000d3ad', amount: '1', validUntil: 1, puid: 'p1',
    };
    expect(offerMatches({ expected: base, submitted: { ...base, puid: 'p2' } })).toBe(false);
  });

  it('hashOffer: changing amount changes the hash (boundary-conversion sanity)', () => {
    // MODULAR: pin that the BigInt(uint256) boundary conversion
    // in hashOffer is wired into the EIP-712 struct — if a future
    // refactor accidentally string-stringifies the amount, the
    // hash will be identical and this test catches it.
    const d = buildDomain(1234);
    const o1: X402Offer = {
      resourceUrl: '/x', scheme: X402_SCHEME, network: X402_NETWORK, asset: X402_ASSET,
      payTo: '0x000000000000000000000000000000000000d3ad', amount: '1', validUntil: 1, puid: 'p',
    };
    const o2 = { ...o1, amount: '2' };
    expect(hashOffer(d, o1)).not.toBe(hashOffer(d, o2));
  });
});

// ── Gateway adapter tests ──────────────────────────────

describe('Gateway adapter (mock mode)', () => {
  it('submitTip returns a deterministic hash + mock: true when GATEWAY_API_URL is missing', async () => {
    const gw = createGatewayAdapter();
    const r = await gw.submitTip({
      from: '0x0000000000000000000000000000000000000001',
      to: '0x000000000000000000000000000000000000d3ad',
      amountUsdc: '0.000001',
      puid: 'mock-puid-1',
    });
    expect(r.mock).toBe(true);
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.status).toBe('settled');
  });

  it('submitTip rejects self-tips', async () => {
    const gw = createGatewayAdapter();
    await expect(
      gw.submitTip({
        from: '0x000000000000000000000000000000000000d3ad',
        to: '0x000000000000000000000000000000000000d3ad',
        amountUsdc: '0.01',
        puid: 'self',
      }),
    ).rejects.toThrow(/self-tip/);
  });

  it('submitTip rejects zero/negative amounts', async () => {
    const gw = createGatewayAdapter();
    await expect(
      gw.submitTip({
        from: '0x0000000000000000000000000000000000000001',
        to: '0x000000000000000000000000000000000000d3ad',
        amountUsdc: '0',
        puid: 'zero',
      }),
    ).rejects.toThrow();
  });

  it('getInfo reports mock: true when no apiUrl', async () => {
    const gw = createGatewayAdapter();
    const info = await gw.getInfo();
    expect(info.mock).toBe(true);
    expect(info.network).toBe('arc-testnet');
  });
});

// ── Route handler tests ────────────────────────────────

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/x402/tip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('x402 tip route', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    mockGateway.submitTip.mockClear();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('returns 402 with PAYMENT-REQUIRED header on first call (no signature)', async () => {
    const req = makeReq({ artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' });
    const res = await tipRoute(req as unknown as Parameters<typeof tipRoute>[0]);
    expect(res.status).toBe(402);
    const pr = res.headers.get('PAYMENT-REQUIRED');
    expect(pr).toBeTruthy();
    const challenge = decodeHeader<X402Offer>(pr!);
    expect(challenge.scheme).toBe(X402_SCHEME);
    expect(challenge.amount).toBe('1'); // 1 lepton
    expect(challenge.network).toBe(X402_NETWORK);
    // CORS expose-headers must be present so the client can read the challenge.
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('PAYMENT-REQUIRED');
  });

  it('returns 200 on a valid signed proof', async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);

    // Step 1: get the challenge
    const first = await tipRoute(makeReq({ artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' }) as unknown as Parameters<typeof tipRoute>[0]);
    expect(first.status).toBe(402);
    const challenge = decodeHeader<X402Offer>(first.headers.get('PAYMENT-REQUIRED')!);
    const domain = buildDomain(Number(BigInt('0x4d2')));

    // Step 2: sign it
    const signature = await account.signTypedData({
      domain,
      types: {
        Offer: [
          { name: 'resourceUrl', type: 'string' },
          { name: 'scheme', type: 'string' },
          { name: 'network', type: 'string' },
          { name: 'asset', type: 'string' },
          { name: 'payTo', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'puid', type: 'string' },
        ],
      },
      primaryType: 'Offer',
      message: challenge,
    });

    // Step 3: submit the proof
    const proofB64 = encodeHeader({ scheme: X402_SCHEME, signature, offer: challenge });
    const second = await tipRoute(
      makeReq(
        { artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' },
        { 'PAYMENT-SIGNATURE': proofB64 },
      ) as unknown as Parameters<typeof tipRoute>[0],
    );
    expect(second.status).toBe(200);
    const json = await second.json();
    expect(json.success).toBe(true);
    expect(json.data.ok).toBe(true);
    expect(json.data.mock).toBe(true);
    expect(json.data.amountMicroUsdc).toBe('1');
    expect(json.data.tipperWallet.toLowerCase()).toBe(account.address.toLowerCase());

    // MODULAR: the proof row is persisted with the recovered tipper
    const [row] = await getTestDb().select().from(x402Proofs).where(eq(x402Proofs.puid, challenge.puid));
    expect(row).toBeDefined();
    expect(row.status).toBe('settled');
    expect(row.tipperWallet.toLowerCase()).toBe(account.address.toLowerCase());

    // Gateway was called once with the right shape
    expect(mockGateway.submitTip).toHaveBeenCalledTimes(1);
    const callArgs = mockGateway.submitTip.mock.calls[0][0];
    expect(callArgs.amountUsdc).toBe('0.000001');
    expect(callArgs.puid).toBe(challenge.puid);
  });

  it('returns 401 on an invalid signature', async () => {
    const first = await tipRoute(makeReq({ artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' }) as unknown as Parameters<typeof tipRoute>[0]);
    const challenge = decodeHeader<X402Offer>(first.headers.get('PAYMENT-REQUIRED')!);
    const bogus = '0x' + '00'.repeat(65);
    const proofB64 = encodeHeader({ scheme: X402_SCHEME, signature: bogus as `0x${string}`, offer: challenge });
    const second = await tipRoute(
      makeReq(
        { artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' },
        { 'PAYMENT-SIGNATURE': proofB64 },
      ) as unknown as Parameters<typeof tipRoute>[0],
    );
    expect(second.status).toBe(401);
  });

  it('returns 409 on a duplicate puid (replay protection)', async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const first = await tipRoute(makeReq({ artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' }) as unknown as Parameters<typeof tipRoute>[0]);
    const challenge = decodeHeader<X402Offer>(first.headers.get('PAYMENT-REQUIRED')!);
    const domain = buildDomain(Number(BigInt('0x4d2')));
    const signature = await account.signTypedData({
      domain,
      types: {
        Offer: [
          { name: 'resourceUrl', type: 'string' },
          { name: 'scheme', type: 'string' },
          { name: 'network', type: 'string' },
          { name: 'asset', type: 'string' },
          { name: 'payTo', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'puid', type: 'string' },
        ],
      },
      primaryType: 'Offer',
      message: challenge,
    });
    const proofB64 = encodeHeader({ scheme: X402_SCHEME, signature, offer: challenge });
    // First submit succeeds
    const r1 = await tipRoute(
      makeReq(
        { artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' },
        { 'PAYMENT-SIGNATURE': proofB64 },
      ) as unknown as Parameters<typeof tipRoute>[0],
    );
    expect(r1.status).toBe(200);
    // Replay the exact same proof
    const r2 = await tipRoute(
      makeReq(
        { artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '0.000001' },
        { 'PAYMENT-SIGNATURE': proofB64 },
      ) as unknown as Parameters<typeof tipRoute>[0],
    );
    expect(r2.status).toBe(409);
  });

  it('returns 400 on an amount that exceeds the per-tip cap', async () => {
    const res = await tipRoute(makeReq({ artistWallet: '0x000000000000000000000000000000000000d3ad', amountUsdc: '5' }) as unknown as Parameters<typeof tipRoute>[0]);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('AMOUNT_TOO_LARGE');
  });

  it('returns 400 on malformed body', async () => {
    const res = await tipRoute(makeReq({}) as unknown as Parameters<typeof tipRoute>[0]);
    expect(res.status).toBe(400);
  });
});
