// MODULAR: tests for src/lib/erc20-transfer.ts. Pure viem, no I/O —
// the test suite exercises the encoder/decoder round-trip plus
// boundary values (zero amount, sub-cent precision, bad inputs).

import { describe, it, expect } from "vitest";
import {
  encodeErc20Transfer,
  decodeErc20TransferCalldata,
  ERC20_TRANSFER_ABI,
} from "@/lib/erc20-transfer";
import { keccak256, toHex, getAddress } from "viem";

// MODULAR: fixtures used across multiple tests — addresses, amounts.
// All addresses use the lowercase canonical form so viem's
// `isAddress()` always accepts them (EIP-55 strict checksum
// enforcement rejects mixed-case if the capitalization is wrong).
const PLATFORM_WALLET = "0xc0ffee254729296a45a3885639a7ce08d249f268";
const RANDO_WALLET = "0x1234567890123456789012345678901234567890";
// MODULAR: a properly-checksummed address for the strict-checksum
// test (lowercase → toUpperCase passed through getAddress). The
// fixture is the well-known vitalik.eth address; getAddress()
// returns the canonical mixed-case form.
const CHECKSUMMED = "0xd8dA6BF26964aF9d7eEd9e03e7B346a6c2C0e11f";

describe("encodeErc20Transfer", () => {
  it("returns a 0xa9059cbb selector prefix (canonical ERC-20 transfer signature)", () => {
    const data = encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "0.50" });
    expect(data.toLowerCase().startsWith("0xa9059cbb")).toBe(true);
  });

  it("matches keccak256 of 'transfer(address,uint256)' over the ABI literal", () => {
    // MODULAR: the keccak of the canonical function signature
    // must equal 0xa9059cbb so the encoder selector stays in
    // sync with the Solidity contract (a 1-byte drift means
    // every tx reverts on-chain).
    const types = ERC20_TRANSFER_ABI as unknown as Array<{
      name: string;
      type: string;
      inputs: Array<{ type: string }>;
    }>;
    const transfer = types.find((m) => m.name === "transfer" && m.type === "function");
    const sig = `transfer(${transfer!.inputs.map((i) => i.type).join(",")})`;
    const hash = keccak256(toHex(sig));
    expect(hash.slice(0, 10).toLowerCase()).toBe("0xa9059cbb");
  });

  it("right-pads the recipient address to 32 bytes (12 zero-bytes + 20-byte addr)", () => {
    // MODULAR: 4 selector bytes + 32-byte addr word + 32-byte
    // amount word + 2 hex prefix = 138 chars total.
    const data = encodeErc20Transfer({ to: RANDO_WALLET, amountUsdc: "0.50" });
    expect(data.length).toBe(2 + 8 + 64 + 64);
    // 32-byte ABI word = 12 zero-bytes of left-padding (24 hex chars)
    // + 20-byte address (40 hex chars). The first 24 hex chars
    // are padding-zero, the last 40 are the address bytes.
    const addrWord = data.slice(10, 10 + 64);
    expect(addrWord.slice(0, 24)).toBe("0".repeat(24));
    expect(addrWord.slice(24).toLowerCase()).toBe(RANDO_WALLET.slice(2).toLowerCase());
  });

  it("encodes 0.50 USDC as 500000n micro-units (= 0x7a120)", () => {
    const data = encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "0.50" });
    const amountHex = data.slice(10 + 64, 10 + 64 + 64);
    // 500000n = 0x7a120, left-padded to 32 bytes (64 hex chars).
    expect(BigInt("0x" + amountHex)).toBe(500_000n);
  });

  it("encodes sub-cent precision (0.001 USDC → 1000n)", () => {
    const data = encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "0.001" });
    const amountHex = data.slice(10 + 64, 10 + 64 + 64);
    expect(BigInt("0x" + amountHex)).toBe(1_000n);
  });

  it("encodes 1 lepton (0.000001 USDC → 1n)", () => {
    const data = encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "0.000001" });
    const amountHex = data.slice(10 + 64, 10 + 64 + 64);
    expect(BigInt("0x" + amountHex)).toBe(1n);
  });

  it("encodes whole-dollar amounts (1.0 USDC → 1_000_000n)", () => {
    const data = encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "1" });
    const amountHex = data.slice(10 + 64, 10 + 64 + 64);
    expect(BigInt("0x" + amountHex)).toBe(1_000_000n);
  });

  it("encodes 0 USDC as 0n", () => {
    const data = encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "0" });
    const amountHex = data.slice(10 + 64, 10 + 64 + 64);
    expect(BigInt("0x" + amountHex)).toBe(0n);
  });

  it("normalizes a properly-formatted EIP-55 checksum address on encode", () => {
    // MODULAR: getAddress() returns the canonical mixed-case
    // EIP-55 checksum for any well-formed address; passing that
    // through the encoder must round-trip — the encoder doesn't
    // re-checksum but the address bytes in the calldata are the
    // same regardless of casing input.
    const checksummed = getAddress(RANDO_WALLET);
    const data = encodeErc20Transfer({ to: checksummed, amountUsdc: "0.50" });
    const addrWord = data.slice(10, 10 + 64);
    // The on-chain address bytes are the 20-byte address only
    // (no "0x" prefix, no checksum casing). Compare against the
    // hex-only body of the input fixture.
    expect(addrWord.slice(24).toLowerCase()).toBe(RANDO_WALLET.slice(2).toLowerCase());
  });

  it("throws on invalid recipient address", () => {
    expect(() => encodeErc20Transfer({ to: "not-an-address", amountUsdc: "0.50" })).toThrow(
      /invalid recipient address/,
    );
  });

  it("throws on non-numeric amount", () => {
    expect(() => encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "abc" })).toThrow();
  });

  it("throws on empty amount", () => {
    expect(() => encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "" })).toThrow(
      /non-empty decimal string/,
    );
  });

  it("throws on negative amount", () => {
    expect(() => encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "-1" })).toThrow();
  });

  it("throws on scientific-notation amount", () => {
    // parseUnits rejects scientific notation by design; assert
    // we surface the same error rather than silently truncating.
    expect(() => encodeErc20Transfer({ to: PLATFORM_WALLET, amountUsdc: "1e9" })).toThrow();
  });

  it("respects a non-default usdcDecimals override", () => {
    // 8-decimal token, "0.50" → 50_000_000n.
    const data = encodeErc20Transfer({
      to: PLATFORM_WALLET,
      amountUsdc: "0.50",
      usdcDecimals: 8,
    });
    const amountHex = data.slice(10 + 64, 10 + 64 + 64);
    expect(BigInt("0x" + amountHex)).toBe(50_000_000n);
  });
});

describe("decodeErc20TransferCalldata (inverse round-trip)", () => {
  it("round-trips a known (address, amount) pair", () => {
    const original = { to: PLATFORM_WALLET, amountUsdc: "0.50" };
    const data = encodeErc20Transfer(original);
    const decoded = decodeErc20TransferCalldata(data);
    expect(decoded.to.toLowerCase()).toBe(PLATFORM_WALLET.toLowerCase());
    expect(decoded.amount).toBe(500_000n);
  });

  it("round-trips sub-cent precision", () => {
    const original = { to: PLATFORM_WALLET, amountUsdc: "0.0001" };
    const data = encodeErc20Transfer(original);
    const decoded = decodeErc20TransferCalldata(data);
    expect(decoded.amount).toBe(100n);
  });

  it("rejects calldata without 0x prefix", () => {
    expect(() => decodeErc20TransferCalldata("a9059cbb")).toThrow(/0x-prefixed hex string/);
  });

  it("rejects calldata with the wrong selector", () => {
    // 0xa9059cbb = transfer. 0x095ea7b3 = approve (different fn).
    // Build a valid-length blob with an approve selector.
    const fakeApprove =
      "0x095ea7b3" + "0".repeat(64) + "0".repeat(64);
    expect(() => decodeErc20TransferCalldata(fakeApprove)).toThrow(/wrong selector/);
  });

  it("rejects calldata shorter than 4 + 32 + 32 bytes", () => {
    expect(() => decodeErc20TransferCalldata("0xa9059cbb")).toThrow(/unexpected calldata length/);
  });
});
