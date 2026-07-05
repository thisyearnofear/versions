// MODULAR: x402 nanopayment protocol helpers.
//
// DRY: the EIP-712 domain, the Offer type, the base64 header
//      encoding, and the signature verification all live here. The
//      route handler uses these to build the 402 challenge and to
//      verify the PAYMENT-SIGNATURE header on the retry; the client
//      uses them (via @/lib/api-client) to sign the challenge with
//      wagmi's useSignTypedData.
//
// CLEAN: pure functions + one viem call. No I/O, no DB. Safe to
//        import from both server (route) and client (api-client)
//        bundles; viem is tree-shakeable.
//
// PERFORMANT: verifyTypedData is O(1); the domain is fetched once
//             per request from the arc adapter and cached.
//
// The x402 offer schema (per circlefin/arc-nanopayments + the
// x402-foundation spec):
//
//   domain = { name, version, chainId }
//   types  = { Offer: [{ resourceUrl, scheme, network, asset,
//                         payTo, amount, validUntil, puid }] }
//
// `chainId` is the actual Arc chainId (not hardcoded to 1) so wagmi
// signs on the connected chain without forcing a switch to Ethereum
// mainnet. The Arc adapter exposes it via getInfo().

import { recoverTypedDataAddress, hashTypedData, getAddress, type TypedDataDomain } from 'viem';

export const X402_VERSION = '1' as const;
export const X402_SCHEME = 'exact' as const;
export const X402_NETWORK = 'arc-testnet' as const;
export const X402_ASSET = 'USDC' as const;

export interface X402Offer {
  resourceUrl: string;
  scheme: typeof X402_SCHEME;
  network: typeof X402_NETWORK;
  asset: typeof X402_ASSET;
  payTo: `0x${string}`;
  amount: string; // micro-units (USDC has 6 decimals)
  validUntil: number; // unix seconds
  puid: string; // payment unit id, server-generated
}

// EIP-712 Offer type. Field order matches the canonical x402 spec
// so the recovered signer is identical regardless of implementation.
// MODULAR: `as const` keeps the literal "Offer" key so viem's
// `VerifyTypedDataParameters` generic infers primaryType tightly;
// a `Record<string, TypedDataParameter[]>` annotation widens it
// to string and breaks verifyTypedData.
export const X402_OFFER_TYPES = {
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
} as const;

/**
 * Build the EIP-712 domain for the connected chain. `chainId` is
 * the actual Arc chainId (per getInfo), not a hardcoded 1, so the
 * wallet signs on its current chain.
 */
export function buildDomain(chainId: number): TypedDataDomain {
  return {
    name: 'VERSIONS x402',
    version: X402_VERSION,
    chainId,
  };
}

/**
 * Encode a challenge/payload as base64 JSON for the x402 headers.
 * Uses standard base64 (not URL-safe) to match the spec.
 */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

// MODULAR: accepts string | null so the route handler can pass
// the result of headers.get() directly without a separate guard;
// returns null for missing/empty input so callers can branch.
export function decodeHeader<T = unknown>(encoded: string | null): T | null {
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as T;
}

/**
 * Verify an EIP-712 signature over an x402 offer and recover the
 * signer's address. Throws `InvalidSignatureError` (from viem)
 * when the signature doesn't recover — the route catches that
 * and returns 401.
 *
 * MODULAR: viem's `recoverTypedDataAddress` is the right call here
 * because it both validates (throws on bad signature) AND returns
 * the recovered address in one go. We deliberately don't use
 * `verifyTypedData` because its TS signature requires an explicit
 * `address` parameter and we don't know the tipper until we
 * recover them.
 */
export async function verifyProof(args: {
  domain: TypedDataDomain;
  offer: X402Offer;
  signature: `0x${string}`;
}): Promise<`0x${string}`> {
  // MODULAR: at the viem boundary, convert amount/validUntil to
  // BigInt (uint256 fields expect bigint) and checksum payTo via
  // getAddress (viem validates `address`-typed fields strictly).
  // The spread preserves the rest of the offer shape.
  const message = {
    ...args.offer,
    amount: BigInt(args.offer.amount),
    validUntil: BigInt(args.offer.validUntil),
    payTo: getAddress(args.offer.payTo),
  };
  return recoverTypedDataAddress({
    domain: args.domain,
    types: X402_OFFER_TYPES,
    primaryType: 'Offer',
    message,
    signature: args.signature,
  });
}

/**
 * Compute the EIP-712 hash of an offer. Useful for the client's
 * pre-flight display ("you are about to sign hash 0x…") and for
 * idempotency keys in the DB.
 */
export function hashOffer(domain: TypedDataDomain, offer: X402Offer): `0x${string}` {
  return hashTypedData({
    domain,
    types: X402_OFFER_TYPES,
    primaryType: 'Offer',
    // MODULAR: same boundary conversion as verifyProof
    // (BigInt for uint256, getAddress for the address field)
    // so the hashed struct is byte-identical to the signed one.
    message: {
      ...offer,
      amount: BigInt(offer.amount),
      validUntil: BigInt(offer.validUntil),
      payTo: getAddress(offer.payTo),
    },
  });
}

/**
 * Validate an incoming offer against a freshly-built challenge.
 * Used by the route to reject any proof that doesn't match the
 * server's expected terms (different amount, payTo, scheme, etc.).
 */
export function offerMatches(args: {
  expected: X402Offer;
  submitted: X402Offer;
}): boolean {
  const e = args.expected;
  const s = args.submitted;
  return (
    e.resourceUrl === s.resourceUrl &&
    e.scheme === s.scheme &&
    e.network === s.network &&
    e.asset === s.asset &&
    e.payTo.toLowerCase() === s.payTo.toLowerCase() &&
    e.amount === s.amount &&
    e.puid === s.puid
  );
}

/**
 * Parse a decimal-string USDC amount into BigInt micro-units. Safe
 * for sub-cent values down to 1 lepton ($0.000001 = 1n).
 */
export function parseAmountToMicroUsdc(amount: string): bigint {
  if (typeof amount !== 'string') throw new Error('amount must be a string');
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error('amount must be a decimal string');
  const [whole, frac = ''] = amount.split('.');
  const padded = (frac + '0'.repeat(6)).slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(padded);
}

/**
 * Format a micro-units BigInt back to a decimal-string USDC amount.
 * Strips trailing zeros for compactness (e.g. "0.10" not "0.100000").
 */
export function formatMicroUsdc(micro: bigint): string {
  const s = micro.toString().padStart(7, '0');
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, '') || '0';
  return frac === '0' ? whole : `${whole}.${frac}`;
}
