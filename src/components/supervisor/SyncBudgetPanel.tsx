"use client";

// MODULAR: Supervisor "Sync budget" — Circle App Kit Send + Unified Balance.
// Funds the platform treasury used for ERC-8183 license settlement and
// agent payouts. Demonstrates App Kit on Arc (Send) and cross-chain
// Unified Balance (Base Sepolia → Arc).

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { getConnectorClient } from "@wagmi/core";
import type { EIP1193Provider } from "viem";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Section, Eyebrow } from "@/components/ui/primitives";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { appKitSendUsdcOnArc, appKitUnifiedBalanceFundArc } from "@/lib/app-kit-client";
import { addressUrl, shortAddress, shortHash, txUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";

const PRESETS = ["5.00", "25.00", "100.00"] as const;

export function SyncBudgetPanel() {
  const { isAuthenticated, requireAuth } = useSupervisorAuth();
  const { isConnected, address, connector } = useAccount();
  const config = useConfig();
  const { showToast } = useToast();

  const [platformWallet, setPlatformWallet] = useState<string | null>(null);
  const [platformBalance, setPlatformBalance] = useState<string | null>(null);
  const [amount, setAmount] = useState("25.00");
  const [busy, setBusy] = useState<"send" | "ub" | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await apiClient.getArcInfo();
      setPlatformWallet(info.platformWallet ?? null);
      setPlatformBalance(info.platformUsdcBalance ?? null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const getProvider = useCallback(async (): Promise<EIP1193Provider> => {
    if (connector?.getProvider) {
      const p = (await connector.getProvider()) as EIP1193Provider | undefined;
      if (p) return p;
    }
    try {
      const client = await getConnectorClient(config);
      const transport = client.transport as { value?: EIP1193Provider; provider?: EIP1193Provider };
      if (transport?.value) return transport.value;
      if (transport?.provider) return transport.provider;
    } catch {
      // fall through
    }
    const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (eth) return eth;
    throw new Error("No EIP-1193 provider — connect a browser wallet");
  }, [connector, config]);

  const onSend = async () => {
    if (!requireAuth("/supervisor#sync-budget")) return;
    if (!isConnected || !platformWallet) {
      showToast("Connect a wallet funded with Arc testnet USDC", "info");
      return;
    }
    setBusy("send");
    try {
      const provider = await getProvider();
      const result = await appKitSendUsdcOnArc({
        provider,
        to: platformWallet,
        amount,
      });
      setLastTx(result.txHash ?? null);
      showToast(
        result.txHash
          ? `Sync budget funded · App Kit Send ${shortHash(result.txHash)}`
          : "Sync budget send submitted",
        "success",
      );
      await refresh();
    } catch (err) {
      showToast(`App Kit Send failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const onUnifiedBalance = async () => {
    if (!requireAuth("/supervisor#sync-budget")) return;
    if (!isConnected || !platformWallet) {
      showToast("Connect a wallet with Base Sepolia USDC", "info");
      return;
    }
    setBusy("ub");
    try {
      const provider = await getProvider();
      const result = await appKitUnifiedBalanceFundArc({
        provider,
        to: platformWallet,
        amount,
      });
      setLastTx(result.spendTx ?? result.depositTx ?? null);
      showToast(
        `Unified Balance · Base→Arc ${result.spendTx ? shortHash(result.spendTx) : "submitted"}`,
        "success",
      );
      await refresh();
    } catch (err) {
      showToast(`Unified Balance failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const balanceDisplay =
    platformBalance != null && platformBalance !== ""
      ? `${(Number(platformBalance) / 1e6).toFixed(2)} USDC`
      : "—";

  return (
    <Section
      id="sync-budget"
      eyebrow="App Kit · Circle"
      title="Sync budget"
      intro="Fund the Arc treasury that settles ERC-8183 licenses and agent payouts — via App Kit Send on Arc, or Unified Balance from Base Sepolia."
      divider={false}
      className="py-8"
    >
      <div className="border border-[var(--color-hair)] rounded-sm p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <Eyebrow className="mb-1">Platform treasury</Eyebrow>
            {platformWallet ? (
              <a
                href={addressUrl(platformWallet)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-[var(--color-ink)] hover:text-[var(--color-rust)]"
              >
                {shortAddress(platformWallet)} ↗
              </a>
            ) : (
              <p className="font-mono text-[11px] text-[var(--color-ink-3)]">Loading…</p>
            )}
          </div>
          <div className="text-right">
            <Eyebrow className="mb-1">Balance on Arc</Eyebrow>
            <p className="font-serif text-xl font-bold tabular-nums">{balanceDisplay}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 border rounded-sm transition-colors",
                amount === p
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]"
                  : "border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-rust)]",
              )}
            >
              ${p}
            </button>
          ))}
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24 border border-[var(--color-hair-strong)] bg-transparent px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:border-[var(--color-ink)]"
            aria-label="Amount USDC"
          />
        </div>

        {!isAuthenticated || !isConnected ? (
          <p className="font-serif text-sm text-[var(--color-ink-2)]">
            Sign in and connect a wallet to fund the sync budget.{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-rust)] hover:underline"
            >
              Circle faucet ↗
            </a>
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={!!busy || !platformWallet}
              className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2.5 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
            >
              {busy === "send" ? "Sending…" : `App Kit Send · $${amount} on Arc`}
            </button>
            <button
              type="button"
              onClick={() => void onUnifiedBalance()}
              disabled={!!busy || !platformWallet}
              className="border border-[var(--color-ink)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2.5 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors disabled:opacity-50"
            >
              {busy === "ub" ? "Bridging…" : `Unified Balance · Base → Arc`}
            </button>
          </div>
        )}

        {address && (
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
            From {shortAddress(address)}
            {lastTx && (
              <>
                {" · "}
                <a href={txUrl(lastTx)} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-rust)]">
                  {shortHash(lastTx)} ↗
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </Section>
  );
}
