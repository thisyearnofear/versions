// MODULAR: ERC-20 transfer calldata encoder. Pure viem, no node-only
// deps — safe to import from Next.js client components, the API
// route handlers, and unit tests.
//
// DRY: the wallet-submit flow (SubmitForm), the x402 tip flow (for
//      batched Gateway settlement), and any future ERC-20 surface
//      all build the same transfer calldata through this module.
//      The server-side arc adapter has its own copy of the encoder
//      (it imports node `crypto` for mock hashing) so we keep this
//      one node-free.
//
// PERFORMANT: `encodeFunctionData` + viem's type-narrowed ABI is
//             a single static call — no I/O, no allocation beyond
//             the resulting hex string. `parseUnits` does the
//             decimal-string → integer BigInt conversion in one
//             step (overloaded to handle any decimals 0..77).
//
// CLEAN: no I/O, no DB, no globals. Safe for unit tests; the
//        test suite exercises this encoder with known vectors.

import { encodeFunctionData, parseUnits, getAddress, isAddress, type Hex } from "viem";

// MODULAR: minimal `transfer(address,uint256)` ABI. Keeps the
// byte-for-byte on-chain signature identical across all surfaces
// (the keccak256 of "transfer(address,uint256)")[]4 == 0xa9059cbb).
// `outputs: [{ type: 'bool' }]` matches the ERC-20 spec so viem's
// type inference produces a properly-typed return for read calls
// (we don't read here, but the ABI shape stays canonical).
export const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export interface EncodeErc20TransferArgs {
  to: string;
  // Decimal-string USDC amount (e.g. "0.50", "0.0001"). Validated
  // by parseUnits — throws on non-numeric / negative / NaN inputs.
  amountUsdc: string;
  // Most USDC deployments are 6 decimals; allow override for
  // contracts that follow a different convention.
  usdcDecimals?: number;
}

/**
 * Encode an ERC-20 `transfer(to, amount)` call. Returns a 0x-prefixed
 * hex string suitable as the `data` field of an EIP-1559 transaction
 * (or the call into `useWriteContract`). Validates the recipient
 * address and the amount up front so a malformed payload fails fast
 * in dev rather than silently in the wallet prompt.
 */
export function encodeErc20Transfer({
  to,
  amountUsdc,
  usdcDecimals = 6,
}: EncodeErc20TransferArgs): Hex {
  if (!isAddress(to)) {
    throw new Error(`encodeErc20Transfer: invalid recipient address: ${to}`);
  }
  if (typeof amountUsdc !== "string" || amountUsdc.trim() === "") {
    throw new Error("encodeErc20Transfer: amountUsdc must be a non-empty decimal string");
  }
  // MODULAR: parseUnits validates the numeric form (rejects "-",
  // "+", "1e9", empty, "abc", etc.) and does the
  // decimal-string → BigInt conversion in one shot overrides via
  // usdcDecimals so non-6-decimal tokens work identically.
  const amount = parseUnits(amountUsdc.trim(), usdcDecimals);
  if (amount < 0n) {
    throw new Error(`encodeErc20Transfer: amount must be non-negative: ${amountUsdc}`);
  }
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [getAddress(to), amount],
  });
}

/**
 * Validate + decode the (to, amount) tuple encoded in a transfer
 * calldata. Inverse of `encodeErc20Transfer` for inspection /
 * verification surfaces (e.g. the post-payment server check shows
 * the artist "we received transfer(platformWallet, 500000)").
 *
 * Throws if the calldata isn't a transfer call (e.g. wrong
 * selector or wrong length). Returns the decoded fields so callers
 * don't need to know the ABI shape.
 */
export function decodeErc20TransferCalldata(data: string): { to: `0x${string}`; amount: bigint } {
  if (typeof data !== "string" || !data.startsWith("0x")) {
    throw new Error("decodeErc20TransferCalldata: calldata must be a 0x-prefixed hex string");
  }
  // Selector (4 bytes = 8 hex chars) + 32-byte address (64 hex) +
  // 32-byte amount (64 hex) + 2-char "0x" prefix = 138 hex chars.
  if (data.length !== 138) {
    throw new Error(`decodeErc20TransferCalldata: unexpected calldata length ${data.length} (expected 138)`);
  }
  // Hardcoded selector check — don't trust the rest of the bytes
  // unless the selector matches `transfer(address,uint256)`.
  const selector = data.slice(0, 10).toLowerCase();
  if (selector !== "0xa9059cbb") {
    throw new Error(`decodeErc20TransferCalldata: wrong selector ${selector} (expected 0xa9059cbb)`);
  }
  // 32-byte address — strip the leading 12 zero-bytes (24 hex chars).
  const addrHex = data.slice(10, 10 + 64);
  const to = getAddress(("0x" + addrHex.slice(24)) as `0x${string}`);
  const amountHex = data.slice(10 + 64, 10 + 64 + 64);
  return { to, amount: BigInt("0x" + amountHex) };
}
