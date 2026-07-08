// MODULAR: pure hex encoding helpers (u8a + BigInt), no React /
// viem / wagmi / process.env deps. Extracted from
// src/components/submit/use-submit-payment.ts (the random tx-hash
// path) and src/adapters/arc.ts (the calldata uint256 encoder)
// so the padStart / padStart(64, "0") patterns don't live as
// ad-hoc one-liners at call sites — every encoding has a named,
// testable helper.
//
// SAFE: this module never falls back to Math.random.
// crypto.getRandomValues is cryptographically secure and
// available in modern browsers (the only realistic deployment
// for the random-hex caller — the mock path replaces an
// on-chain broadcast, not a server-side secret). The test
// setup at tests/helpers/setup.ts polyfills it for older Node
// versions in CI so the test suite stays portable without
// weakening the production contract.

/**
 * MODULAR: encode a Uint8Array as a "0x"-prefixed lowercase hex
 * string. Two hex chars per byte, zero-padded on the left for
 * values < 0x10. Loop-based instead of `Array.from(bytes).map`
 * because (a) it avoids the per-byte closure allocation that
 * shows up in microbenchmarks when the input is large (an EVM
 * tx-hash is 32 bytes, a calldata blob is hundreds), and (b)
 * the type system tracks the result as a `` `0x${string}` ``
 * template-literal type — same as viem's `Hex` — so it
 * composes with hooks that expect viem's nominal types.
 *
 * MODULAR: accepts arbitrary byte lengths. The 32-byte
 * (tx-hash) and 20-byte (address) shapes are the two callers
 * care about today; if a future protocol needs a 64-byte
 * signature encoding the same function covers it without
 * branching.
 */
export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out as `0x${string}`;
}

/**
 * MODULAR: produce a cryptographically-random hex string of the
 * requested byte length (output is `2 * byteLen + 2` chars
 * including the "0x" prefix). Single allocation of the byte
 * buffer, single pass through bytesToHex so the helper is
 * cheap enough to call inside the form's mock-fallback path
 * without memoizing.
 */
export function randomHex(byteLen: number): `0x${string}` {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * MODULAR: 32-byte random hex — the canonical EVM tx-hash shape
 * (keccak256 output, 256-bit wide). The shape (66 chars,
 * "0x"-prefixed) is what `viem` + `wagmi` declare as `Hex`,
 * `TransactionReceipt['transactionHash']`, etc., so the result
 * plugs straight into `writeContractAsync`'s callback chain
 * without an `as` cast at the call site.
 *
 * MODULAR: the mock path in use-submit-payment.ts uses this
 * helper so the receiving form code path doesn't notice the
 * difference between "real on-chain tx" and "dev-only fallback"
 * — type-identical, same downstream consumers (verifyPayment
 * server endpoint, lastTxHash cache, retry path).
 */
export function randomTxHash(): `0x${string}` {
  return randomHex(32);
}

/**
 * MODULAR: BigInt → big-endian hex string of exactly
 * `byteLen * 2` characters, no "0x" prefix. Used by the
 * calldata builders in src/adapters/arc.ts (encodeUint256 →
 * 32-byte uint256 for ERC-20 transfer calldata) so the
 * padStart logic is testable in isolation rather than buried at
 * a single call site that previously combined normalization +
 * validation + toString(16) + padStart in one function.
 *
 * MODULAR: throws on negative input. BigInt supports signed
 * values, but the only legitimate use case for this helper is
 * unsigned calldata encoding; a negative input would silently
 * break the 64-char length invariant (BigInt.toString(16)
 * preserves the minus sign, e.g. `(-1n).toString(16) === "-1"`,
 * which would pad-left to "0000…-1" — malformed calldata).
 * Catching this at the encoder boundary is cheaper than
 * debugging bad calldata at the chain RPC.
 *
 * MODULAR: throws on overflow. If value.toString(16).length
 * exceeds byteLen * 2, the encoded hex would not fit in
 * `byteLen` bytes' worth of calldata — the input must be
 * out-of-range before reaching this helper. Surface the error
 * here so callers see "2048-byte value won't fit in 32-byte
 * uint256" rather than shipping malformed calldata.
 *
 * MODULAR: lowercase hex by default (BigInt.toString(16) is
 * lowercase); no "0x" prefix; result is the raw hex string
 * callers concatenate into calldata blobs. If a future caller
 * needs "0x"-prefixed output, wrap with "0x" + result at the
 * call site rather than adding a flag here.
 */
export function bigIntToPaddedHex(value: bigint, byteLen: number): string {
  if (value < 0n) {
    throw new Error("bigIntToPaddedHex: value must be non-negative");
  }
  const hex = value.toString(16);
  if (hex.length > byteLen * 2) {
    throw new Error(
      `bigIntToPaddedHex: value ${value} exceeds ${byteLen}-byte width (${byteLen * 2} hex chars max)`,
    );
  }
  return hex.padStart(byteLen * 2, "0");
}

/**
 * MODULAR: 40-char hex (20-byte EVM address, no "0x" prefix) →
 * 64-char big-endian padded hex (32 bytes, no "0x" prefix) for
 * ERC-20 calldata builders. Co-located with bytesToHex +
 * bigIntToPaddedHex so the "0".repeat(24) + slice + lowercase
 * chain that previously lived inline in src/adapters/arc.ts
 * encodeAddress is testable in isolation rather than baked into
 * a single 4-line function that mixed viem-validation +
 * checksum-normalize + zero-pad.
 *
 * MODULAR: pure input contract. The caller is responsible for
 * stripping any "0x" prefix (the only production caller,
 * encodeAddress, does `getAddress(addr).slice(2)` before
 * forwarding — viem's `getAddress` is what validates the
 * string and returns the canonical mixed-case checksum). This
 * helper assumes a well-formed 40-char hex string and refuses
 * to guess at prefixes or case normalization. Result is always
 * lowercase so byte-level comparisons (e.g., grep on calldata
 * blobs in tests) are deterministic.
 *
 * MODULAR: refuses non-hex input (`g`-`z`, special chars,
 * Unicode) at the encoder boundary. Without this check a
 * future caller passing a non-address string would silently
 * produce a padded string with invalid hex chars, breaking
 * calldata downstream. Better to surface the error here than
 * at the chain RPC.
 */
export function addressToPaddedHex(addrHex40: string): string {
  if (!/^[0-9a-fA-F]{40}$/.test(addrHex40)) {
    throw new Error(
      `addressToPaddedHex: expected a 40-char hex address (20 bytes, no "0x" prefix), got "${addrHex40}" (length ${addrHex40.length})`,
    );
  }
  return addrHex40.toLowerCase().padStart(64, "0");
}
