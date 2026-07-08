// MODULAR: tests for src/lib/hex-utils.ts. Mirrors the
// expected use-submit-payment.ts mock-path behavior (32-byte
// random tx hash, "0x" prefix, hex-digit-only payload) +
// the arc.ts calldata encoders (BigInt → fixed-width big-endian
// hex + 40-char address → 64-char padded hex) so the assertion
// suite catches any future drift in any of the three helpers
// before it surfaces at the form layer or at the chain RPC.
// crypto.getRandomValues is polyfilled globally by
// tests/helpers/setup.ts so the random paths work in any Node
// version the CI covers.

import { describe, it, expect } from "vitest";
import {
  bytesToHex,
  randomHex,
  randomTxHash,
  bigIntToPaddedHex,
  addressToPaddedHex,
} from "@/lib/hex-utils";

const HEX_DIGITS_ONLY = /^0x[0-9a-f]*$/;

describe("bytesToHex", () => {
  it("encodes an empty byte array as just the '0x' prefix", () => {
    expect(bytesToHex(new Uint8Array(0))).toBe("0x");
  });

  it("encodes a single 0x00 byte with left-zero padding", () => {
    expect(bytesToHex(new Uint8Array([0]))).toBe("0x00");
  });

  it("encodes a single 0x0a byte with left-zero padding", () => {
    // Left-pad matters: `.toString(16)` returns "a", not "0a".
    // If a future refactor drops padStart, this assertion breaks.
    expect(bytesToHex(new Uint8Array([0x0a]))).toBe("0x0a");
  });

  it("encodes a single 0x10 byte correctly (no pad needed)", () => {
    expect(bytesToHex(new Uint8Array([0x10]))).toBe("0x10");
  });

  it("encodes a single 0xff byte (max single byte)", () => {
    expect(bytesToHex(new Uint8Array([0xff]))).toBe("0xff");
  });

  it("encodes a mixed sequence preserving byte order", () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x01, 0xff, 0xab]))).toBe(
      "0x0001ffab",
    );
  });

  it("encodes a 32-byte array as a 66-character string (32 bytes → 64 hex chars + '0x')", () => {
    const input = new Uint8Array(32);
    const out = bytesToHex(input);
    expect(out.length).toBe(66);
    expect(out.startsWith("0x")).toBe(true);
  });

  it("encodes a 20-byte array as a 42-character string (EVM address shape)", () => {
    const input = new Uint8Array(20);
    const out = bytesToHex(input);
    expect(out.length).toBe(42);
    expect(out.startsWith("0x")).toBe(true);
  });

  it("returns a template-literal-type-compatible string (cast to `` `0x${string}` ``)", () => {
    // No runtime check possible — but the absence of a TS error
    // at compile time is the contract callers rely on. This test
    // exercises the compile-time assertion by importing the
    // helper result into a viem-only consumer shape.
    const out: `0x${string}` = bytesToHex(new Uint8Array([1]));
    expect(out).toBe("0x01");
  });
});

describe("randomHex", () => {
  it("encodes a zero-length request as just the '0x' prefix", () => {
    expect(randomHex(0)).toBe("0x");
  });

  it("produces a string of length 2 * byteLen + 2 (including '0x')", () => {
    // Acceptable byte lengths for any plausible crypto use-case.
    for (const byteLen of [16, 20, 32, 64]) {
      expect(randomHex(byteLen).length).toBe(2 * byteLen + 2);
    }
  });

  it("starts with the '0x' prefix on every output", () => {
    expect(randomHex(32).startsWith("0x")).toBe(true);
    expect(randomHex(64).startsWith("0x")).toBe(true);
  });

  it("uses only hex characters (0-9, a-f) after the prefix", () => {
    // Statistical check: a real cryptographic RNG produces only
    // hex digits here, so a regression that starts emitting
    // uppercase / non-hex fails immediately.
    expect(randomHex(32)).toMatch(HEX_DIGITS_ONLY);
    expect(randomHex(64)).toMatch(HEX_DIGITS_ONLY);
  });

  it("produces distinct outputs across repeated calls (statistical distinctness)", () => {
    // MODULAR: two calls in a row producing the same value would
    // indicate the RNG is broken or the helper is returning a
    // cached constant. The probability of a duplicate 64-hex-char
    // collision is 2^-256 — astronomically small. So this
    // assertion passes deterministically given a working RNG.
    const a = randomHex(32);
    const b = randomHex(32);
    expect(a).not.toBe(b);
  });
});

describe("randomTxHash", () => {
  it("produces a 66-character string (32 bytes → 64 hex chars + '0x')", () => {
    expect(randomTxHash().length).toBe(66);
  });

  it("starts with the '0x' prefix", () => {
    expect(randomTxHash().startsWith("0x")).toBe(true);
  });

  it("uses only hex characters (0-9, a-f)", () => {
    expect(randomTxHash()).toMatch(HEX_DIGITS_ONLY);
  });

  it("distinct calls produce distinct outputs", () => {
    expect(randomTxHash()).not.toBe(randomTxHash());
  });

  it("is shape-identical to viem's Hex type for downstream consumers", () => {
    // Compiles only if the helper's return type is `` `0x${string}` `` —
    // viem's Hex nominal type. A future regression to `string` would
    // break this assignment at the typecheck level.
    const out: `0x${string}` = randomTxHash();
    expect(out.length).toBe(66);
  });
});

describe("bigIntToPaddedHex", () => {
  // ► Zero + small values
  it("encodes 0n as all zeros of exactly byteLen * 2 chars", () => {
    expect(bigIntToPaddedHex(0n, 32)).toBe("0".repeat(64));
  });

  it("encodes 1n with the value at the rightmost position", () => {
    // MODULAR: "...0001" is the canonical little-/big-endian-
    // agnostic ABI encoding for the literal 1. Verify the
    // left-pad happened — a regress to "1" or "1..pad" fails.
    const out = bigIntToPaddedHex(1n, 32);
    expect(out).toBe("0".repeat(63) + "1");
    expect(out.length).toBe(64);
  });

  it("encodes 255n as ...00ff", () => {
    expect(bigIntToPaddedHex(255n, 32)).toBe("0".repeat(62) + "ff");
  });

  it("encodes 256n with the carry into the second-to-last byte (0000…0100)", () => {
    // MODULAR: 256 = 0x100 — 3 hex digits, two bytes' worth.
    // The hex string is "100" so it fits at the end of a 64-char
    // zero-prefixed buffer. If the carry stays in the high byte
    // (encoding to "0100" instead of "100"), the encoder has
    // off-by-one in the byte boundary.
    expect(bigIntToPaddedHex(256n, 32)).toBe("0".repeat(61) + "100");
  });

  it("encodes the maximum uint256 (2^256 - 1) without over-padding", () => {
    const maxUint256 = (1n << 256n) - 1n;
    const out = bigIntToPaddedHex(maxUint256, 32);
    expect(out).toBe("f".repeat(64));
    expect(out.length).toBe(64);
  });

  // ► Byte-length variants
  it("encodes 1n into a 1-byte width as '01'", () => {
    expect(bigIntToPaddedHex(1n, 1)).toBe("01");
  });

  it("encodes 1n into a 20-byte width (40 zeros + '1')", () => {
    // MODULAR: 20-byte width matches the would-be EVM address
    // encoding shape if a future caller asks for an address-
    // sized uint. Verify the helper supports non-32 widths.
    expect(bigIntToPaddedHex(1n, 20)).toBe("0".repeat(39) + "1");
  });

  it("returns a string of length exactly byteLen * 2 (no '0x', no extra)", () => {
    for (const byteLen of [1, 4, 16, 20, 32]) {
      expect(bigIntToPaddedHex(7n, byteLen).length).toBe(byteLen * 2);
    }
  });

  // ► Output shape
  it("never includes a '0x' prefix", () => {
    expect(bigIntToPaddedHex(1n, 32).startsWith("0x")).toBe(false);
    expect(bigIntToPaddedHex(255n, 32).startsWith("0x")).toBe(false);
  });

  it("uses only lowercase hex characters (0-9, a-f)", () => {
    // BigInt.toString(16) is lowercase by default — but pin
    // it in a test so a future refactor doesn't silently flip
    // to uppercase (which would still produce a valid hex
    // blob, but break byte-level comparisons with keccak256).
    expect(bigIntToPaddedHex((1n << 256n) - 1n, 32)).toBe("f".repeat(64));
    expect(bigIntToPaddedHex(0xabcdefn, 32)).toMatch(/^0*abcdef$/);
  });

  // ► Error cases
  it("throws on negative input (BigInt supports signed but encoding is unsigned)", () => {
    // The encoder boundary catches this so malformed calldata
    // (e.g. "...-1" after padStart with the minus preserved)
    // never reaches the chain RPC. arc.ts callers validate
    // before this point; the helper-level guard is the
    // last-line safety for any new caller.
    expect(() => bigIntToPaddedHex(-1n, 32)).toThrow(
      /bigIntToPaddedHex: value must be non-negative/,
    );
  });

  it("throws on overflow (value exceeds byteLen-byte width)", () => {
    // 2^256 won't fit in 32 bytes (= 256 bits); throws so
    // bad calldata is surfaced at the encoder, not at the
    // chain RPC.
    expect(() => bigIntToPaddedHex(1n << 256n, 32)).toThrow(
      /exceeds 32-byte width/,
    );
  });

  it("throws with a useful message that includes the byte width", () => {
    // The error message must surface the byte width so a
    // future caller debugging "this uint256 is too big"
    // immediately knows whether to widen or to truncate.
    expect(() => bigIntToPaddedHex(1n << 256n, 16)).toThrow(
      /exceeds 16-byte width/,
    );
  });
});

describe("addressToPaddedHex", () => {
  // MODULAR: synthetic 40-char fixtures — using "ab".repeat(20)
  // (lowercase), "AB".repeat(20) (uppercase), and
  // "AbCdEf".repeat(20 / 6) (mixed) so the case-lowering
  // normalization is exercised at every input variant.

  // ► Lower-case input (canonical)
  it("pads a 40-char lowercase address to a 64-char hex with leading zeros", () => {
    // "ab" * 20 = 40 chars. High bit = 0xa (1010) so the
    // leading zero count is exactly 24 — full 48 hex chars
    // (24 bytes) before the address body starts.
    expect(addressToPaddedHex("ab".repeat(20))).toBe("0".repeat(24) + "ab".repeat(20));
  });

  // ► Upper-case input (must normalize down)
  it("lowercases a 40-char uppercase address before padding", () => {
    // Same byte content as the lowercase case — verify the
    // `.toLowerCase()` runs before padStart. A regression that
    // foregoes the lowercase produces an uppercase output that
    // fails the byte-level hex comparison elsewhere in tests.
    expect(addressToPaddedHex("AB".repeat(20))).toBe("0".repeat(24) + "ab".repeat(20));
  });

  // ► Mixed-case input
  it("lowercases a 40-char mixed-case address before padding", () => {
    // "AbCdEf" * 6 + "ab" * 2 = 36 + 4 = 40 chars. Build the
    // expected output from the input via .toLowerCase() so
    // any manual repetition count (where a previous version
    // of this test had an off-by-one error) is impossible —
    // the expected is just "24 zeros + the input lowercased",
    // which is exactly what the helper does.
    const input = "AbCdEf".repeat(6) + "ab".repeat(2);
    expect(input.length).toBe(40);
    expect(addressToPaddedHex(input)).toBe("0".repeat(24) + input.toLowerCase());
  });

  // ► Zero address
  it("encodes the all-zero address (40 chars of '0') as 64 chars of '0'", () => {
    // The zero address is a degenerate-but-valid ERC-20 recipient
    // (every contract treats it as a no-op / burn depending on
    // semantics). Verify the encoder handles it without surprises.
    expect(addressToPaddedHex("0".repeat(40))).toBe("0".repeat(64));
  });

  // ► Length invariant
  it("always returns a 64-character string (no '0x', no padding prefix)", () => {
    expect(addressToPaddedHex("ab".repeat(20)).length).toBe(64);
    expect(addressToPaddedHex("0".repeat(40)).length).toBe(64);
    expect(addressToPaddedHex("f".repeat(40)).length).toBe(64);
  });

  it("never includes a '0x' prefix in the output", () => {
    // Calldata blobs are un-prefixed. A regression that emits
    // "0x" + 64 hex chars would break calldata length (would
    // be 66 instead of 64).
    expect(addressToPaddedHex("ab".repeat(20)).startsWith("0x")).toBe(false);
  });

  it("preserves byte order (output ends with the input body in lower case)", () => {
    // Independent test from the case-normalization test:
    // even with uppercase input, the byte content survives
    // case-fold. If a regression inserts a byte-swap
    // (e.g., big-endian → little-endian), this assertion fails.
    expect(addressToPaddedHex("DEAdBeef".repeat(5)).endsWith("deadbeef".repeat(5))).toBe(
      true,
    );
  });

  // ► Error cases
  it("throws when the input is shorter than 40 chars", () => {
    // 39 chars — one short of the expected width. Helper
    // refuses to guess a padding for missing bytes.
    expect(() => addressToPaddedHex("ab".repeat(20).slice(0, 39))).toThrow(
      /addressToPaddedHex: expected a 40-char hex address/,
    );
  });

  it("throws when the input is longer than 40 chars", () => {
    // 41 chars — even one extra hex char signals the caller
    // passed something that isn't an address shape (could be
    // a calldata word, a hash, a tx id). Refuse at the encoder.
    expect(() => addressToPaddedHex("ab".repeat(20) + "a")).toThrow(
      /addressToPaddedHex: expected a 40-char hex address/,
    );
  });

  it("throws when the input contains non-hex characters", () => {
    // "z" / "g" / "!" / Unicode. The regex test catches all
    // of these at once.
    expect(() => addressToPaddedHex("z" + "ab".repeat(20).slice(1))).toThrow(
      /addressToPaddedHex: expected a 40-char hex address/,
    );
    expect(() => addressToPaddedHex("abcdefghij" + "ab".repeat(15))).toThrow(
      /addressToPaddedHex: expected a 40-char hex address/,
    );
  });

  it("throws when the input is the empty string", () => {
    expect(() => addressToPaddedHex("")).toThrow(
      /addressToPaddedHex: expected a 40-char hex address/,
    );
  });

  it("throws when the input still has a '0x' prefix (caller must strip first)", () => {
    // MODULAR: the helper's contract is strict — bare 40-char
    // hex. The arc.ts caller pre-strips with getAddress(addr)
    // .slice(2); a future caller forgetting this step sees a
    // helpful error rather than silently producing a 66-char
    // "0x"-prefixed calldata-pad.
    expect(() => addressToPaddedHex("0x" + "ab".repeat(20))).toThrow(
      /addressToPaddedHex: expected a 40-char hex address/,
    );
  });

  it("throws with a useful message reporting actual input + length", () => {
    // The error message helps an operator debugging "the
    // calldata encoder rejected my address" without re-running
    // the form: it surfaces both the literal input and the
    // length that failed the regex.
    let caught: Error | null = null;
    try {
      addressToPaddedHex("nope");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/got "nope"/);
    expect(caught!.message).toMatch(/length 4/);
  });
});
