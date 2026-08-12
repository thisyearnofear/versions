import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveWalletIdentity, shortAddress, isWalletAddress } from "@/lib/wallet-identity";

describe("wallet-identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shortAddress truncates 0x addresses", () => {
    expect(shortAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe("0xd8dA…6045");
  });

  it("isWalletAddress validates shape", () => {
    expect(isWalletAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
    expect(isWalletAddress("vitalik.eth")).toBe(false);
  });

  it("prefers ensdata ENS when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("ensdata")) {
          return {
            ok: true,
            json: async () => ({
              ens: "vitalik.eth",
              ens_primary: "vitalik.eth",
              avatar: "https://euc.li/vitalik.eth",
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const id = await resolveWalletIdentity("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(id.source).toBe("ensdata");
    expect(id.ens).toBe("vitalik.eth");
    expect(id.displayName).toBe("vitalik.eth");
    expect(id.avatar).toContain("vitalik");
  });

  it("falls back to web3.bio when ensdata has no name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("ensdata")) {
          return { ok: true, json: async () => ({ address: "0xabc" }) };
        }
        if (String(url).includes("web3.bio")) {
          return {
            ok: true,
            json: async () => [
              {
                platform: "farcaster",
                identity: "alice",
                displayName: "Alice",
                avatar: "https://example.com/a.png",
              },
            ],
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const id = await resolveWalletIdentity("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(id.source).toBe("web3.bio");
    expect(id.displayName).toBe("Alice");
    expect(id.avatar).toBe("https://example.com/a.png");
  });

  it("returns truncated address when both providers miss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
    const addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const id = await resolveWalletIdentity(addr);
    expect(id.source).toBe("none");
    expect(id.displayName).toBe(shortAddress(addr));
  });
});
