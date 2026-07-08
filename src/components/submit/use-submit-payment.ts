"use client";

// MODULAR: useSubmitPayment — the wallet-side payment wiring for
// the submit form. Encapsulates the wagmi hooks + Arc-info fetch +
// chain switching + ERC-20 transfer signing into one async function
// the form calls. Returns a `phase` state machine for the UI.
//
// DRY: every other submission-related payment surface (if any are
//      added later) should call this hook instead of touching
//      wagmi/useWriteContract directly. The chain switch + ABI
//      encoding + error mapping live here in one place.
//
// SAFE:   writeContractAsync fires once the user's wallet returns
//         the broadcast hash — but on slow / congested chains Arc
//         RPC's mempool indexing lags the wallet by tens of seconds.
//         If we resolve sendPayment immediately and the form
//         POSTs txHash to verifyPayment, the server reads from a
//         txpool that doesn't yet have the hash → returns "not
//         yet visible" → retry storm. So after writeContractAsync
//         returns we call waitForTransactionReceipt(config, ...) for
//         one confirmation. This is the wagmi-pattern equivalent of
//         MetaMask SDK's confirmation: waits until the block
//         containing our tx is on-chain before letting the form call
//         verifyPayment. Mock path skips the wait (no real tx).
//
// CLEAN: the hook never throws to the React tree — sendPayment
//        throws an `Error` with a wallet-friendly message that
//        the form catches and displays via `showToast`. Network
//        failures + UserRejectedRequestError + ContractFunctionRevert
//        + receipt-timeout are all mapped to readable messages.

import { useCallback, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { Hex } from "viem";
import { apiClient, type ArcInfo, ApiError } from "@/lib/api-client";
import { ERC20_TRANSFER_ABI } from "@/lib/erc20-transfer";
import { parseAmountToMicroUsdc } from "@/lib/x402";
import { ARC_TESTNET_ID, wagmiConfig } from "@/lib/wagmi";
// MODULAR: type-identical random tx-hash for the dev/preview mock path
// so the form code doesn't branch on "real broadcast" vs
// "fallback". randomTxHash returns a 32-byte `` `0x${string}` ``
// identical in shape to viem's Hex, so writeContractAsync callers
// don't need an `as` cast. See src/lib/hex-utils.ts.
import { randomTxHash } from "@/lib/hex-utils";
// MODULAR: bounded wait window for 1-confirmation on Arc. The
// bounds + env-var parser live in src/lib/submit-config so any
// future client-side caller (telemetry APIs, settlement sweeper
// polling cadence) reads the same config without re-deriving.
// wagmi passes SUBMIT_RECEIPT_TIMEOUT_MS through to viem which
// polls every ~1s. After it elapses, viem/receipt waiter throws
// TimeoutErrorMs — caught + mapped to a wallet-friendly message
// by the hook. 60s default is generous on Arc testnet (block
// time averages ~1s); this is a ceiling for a wedged RPC,
// dropped tx, or extreme mempool reorg. We throw rather than
// resolve-cached-hash so the form's existing `lastTxHash.current`
// retry-cache path can still re-attempt verifyPayment with the
// same hash (it's on-chain, the verify endpoint will eventually
// see it) without burning a fresh tx + gas.
//
// MODULAR: timeout is env-overridable via
// NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS (Next.js inlines the
// value into the client bundle at build time, so no runtime
// fetch / extra round-trip). Operators on Arc mainnet (or a
// future chain with different block time) tune without a code
// redeploy. The min/max bounds in submit-config.ts prevent
// operator typos — `"0"` would be viem's forever-wait sentinel,
// `"abc"` would NaN out, `"10000000"` would hang the retry UI
// forever. Anything outside [MIN, MAX] silently falls back to
// the default so the form stays shippable; the rendered error
// message always shows the actual configured value (see
// `${SUBMIT_RECEIPT_TIMEOUT_MS / 1000}s` below) so an operator
// debugging a real timeout can spot a mis-set env var.
import { SUBMIT_RECEIPT_TIMEOUT_MS } from "@/lib/submit-config";

export type PaymentPhase =
  | { phase: "idle" }
  // MODULAR: surfaced when Arc is configured in mock-only mode
  // (no ARC_RPC_URL / no USDC contract / no platform wallet).
  // The submit flow stays exercisable end-to-end so devs and
  // preview deployments don't require chain config to test the
  // UI. Surfaced separately from `idle` so the form can show a
  // "DEV-ONLY MOCK" banner and an honest `track()` event.
  | { phase: "mocked"; reason: "arc-mock" | "missing-config" }
  | { phase: "switching_chain"; targetChainId: number }
  | { phase: "awaiting_wallet_sign" }
  // writeContractAsync returned a hash; the hook now polls Arc RPC
  // for one block confirmation before resolving sendPayment. The
  // form does NOT move on to verifyPayment until the `broadcasting`
  // phase exits, which means verifyPayment will always see a tx
  // that's already in a mined block — Arc's mempool is no longer
  // racing the verify endpoint.
  | { phase: "broadcasting"; txHash: Hex }
  // MODULAR: `txHash` is optional because not every error means a
  // tx was broadcast (writeContract / switchChain / getArcInfo
  // errors happen before any on-chain activity). Only the
  // receipt-timeout catch carries a hash: by that point the
  // wallet returned a txHash, setPhase({ phase: "broadcasting"})
  // ran, and the only thing that failed is Arc RPC confirming the
  // block. Carrying the hash on the error variant lets the form's
  // retryVerifyPayment fall back to verifying the same hash
  // (instead of burning a fresh tx on user funds) when Arc RPC
  // is just lagging.
  | { phase: "error"; message: string; txHash?: Hex };

export interface SendPaymentResult {
  txHash: Hex;
  // MODULAR: the form's success toast + analytics event rely on
  // this flag, not on inspecting the phase machine after the
  // await closes. Returning it from sendPayment directly avoids
  // the React-closure-timing bug where `paymentPhase` inside the
  // caller's closure still reads the pre-send value.
  mocked: boolean;
  // MODULAR: the chain the hook actually settled on (or null on
  // the mock-fallback path). The form's analytics event uses
  // this rather than a hardcoded wagmi constant so future
  // operators on non-testnet Arc (or other supported chains)
  // land honest chain metadata in the funnel telemetry.
  chainId: number | null;
  // MODULAR: reason the mock path was taken, if any. Distinguishes
  // deliberate preview deploys (`arc-mock`) from operational
  // misconfig (`missing-config`) so an ops dashboard can tell
  // "we're in DEV mode" apart from "operator fat-fingered the
  // env vars in production". Null on real broadcasts.
  mockReason: "arc-mock" | "missing-config" | null;
}

export interface UseSubmitPaymentArgs {
  feeAmountUsdc: string;
}

export interface UseSubmitPaymentResult {
  phase: PaymentPhase;
  sendPayment: () => Promise<SendPaymentResult>;
  reset: () => void;
  arcInfo: ArcInfo | null;
}

// MODULAR: surface a wallet-friendly message no matter which
// wagmi error shape we caught. wagmi+viem throw a mix of
// UserRejectedRequestError, ChainMismatchError, ContractFunctionRevert,
// and raw RPC errors; the form just wants something to toast.
function describePaymentError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg.length === 0) return "Payment failed (unknown error)";
    return msg;
  }
  return "Payment failed (non-Error thrown)";
}

export function useSubmitPayment({ feeAmountUsdc }: UseSubmitPaymentArgs): UseSubmitPaymentResult {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<PaymentPhase>({ phase: "idle" });
  // MODULAR: cache the ArcInfo fetch so retries (the form's
  // PAYMENT_RETRIES path) don't re-hit the server every attempt.
  // One fresh fetch per submit flow is enough — config changes
  // require a server restart, so caching for the lifetime of the
  // component is safe.
  const [arcInfo, setArcInfo] = useState<ArcInfo | null>(null);

  const sendPayment = useCallback(async (): Promise<SendPaymentResult> => {
    if (!isConnected || !address) {
      const message = "Connect your wallet to send the submission fee.";
      setPhase({ phase: "error", message });
      throw new Error(message);
    }

    // MODULAR: fetch the latest ArcInfo so we know whether we're
    // in mock mode (dev/preview) or on a real chain. Each retry
    // round-trips the server — cheap, and lets the operator flip
    // ARC_RPC_URL at runtime without a deploy.
    let info: ArcInfo;
    try {
      info = await apiClient.getArcInfo();
      setArcInfo(info);
    } catch (err) {
      const message = "Couldn't reach the payment server.";
      setPhase({ phase: "error", message });
      throw new Error(`${message}: ${describePaymentError(err)}`);
    }

    // ── Mock path ──
    // MODULAR: the real-EVM branch is gated on (a) NOT in mock mode,
    // (b) having a USDC contract address, (c) having a platform
    // wallet recipient, (d) having the chain ID we need to switch
    // to. Any missing field falls back to the random-hash mock so
    // the demo never breaks; a console.warn flags it for the dev
    // who hits it. The `mocked` flag returned to the caller is set
    // here so the form's toast + analytics reflect the actual
    // outcome (real tx NOT executed; demo approved only).
    const realPathAvailable =
      !info.mock && !!info.usdcContract && !!info.platformWallet && !!info.chainId;
    if (!realPathAvailable) {
      const reason: "arc-mock" | "missing-config" = info.mock ? "arc-mock" : "missing-config";
      if (typeof console !== "undefined") {
        // MODULAR: noise — only logged in browsers, only when a
        // real user's tx would have befallen this fallback. Easier
        // to grep in the dev console than a silent failure.
        console.warn(
          `[useSubmitPayment] real transfer unavailable (${reason}); generating random hash.`,
          { mock: info.mock, hasContract: !!info.usdcContract, hasWallet: !!info.platformWallet, hasChain: !!info.chainId },
        );
      }
      // MODULAR: dev/preview-only fallback. The 32-byte hex shape
      // matches what real writeContractAsync returns so the form
      // doesn't branch on "real broadcast" vs "fallback". Wrapping
      // hex generation in randomTxHash keeps the encoding
      // (Array.from + padStart + getRandomValues) testable in
      // isolation — see tests/unit/hex-utils.test.ts.
      const txHash = randomTxHash();
      setPhase({ phase: "mocked", reason });
      // MODULAR: mock path returns chainId: null so the form's
      // analytics event accurately tags the broadcast as
      // "no on-chain settlement". Future Arc-mainnet operators
      // won't confuse a DEV mock with a real mainnet tx. The
      // `mockReason` lets ops dashboards distinguish deliberate
      // preview deploys (`arc-mock`) from operational misconfig
      // (`missing-config`) — both fall through this branch.
      return { txHash, mocked: true, chainId: null, mockReason: reason };
    }

    // MODULAR: server reports the chain ID as a hex string per
    // the JSON-RPC eth_chainId convention (e.g. "0x4ce572" for
    // 5042002). Convert to a JS number for wagmi's chainId param.
    const targetChainId = Number(BigInt(info.chainId as string));
    // MODULAR: defensive runtime validation. wagmi is a literal
    // union of registered chains at the type level — but the cast
    // at the call site (`as Parameters<...>`) erases that
    // protection. If the server reports a chain ID wagmi has no
    // transport / chain def for (e.g., wagmi configured for
    // testnet but server on mainnet, or a future chain), wagmi
    // silently misroutes or throws an asynchronous, un-actionable
    // error. Reject with an explicit message before any wallet
    // interaction so the operator gets an actionable fix.
    if (targetChainId !== ARC_TESTNET_ID) {
      const message = `Server reports chain ${targetChainId} but wagmi is configured for Arc testnet (${ARC_TESTNET_ID}). Update wagmi.ts to add the new chain or set ARC_RPC_URL to a ${ARC_TESTNET_ID} endpoint.`;
      setPhase({ phase: "error", message });
      throw new Error(message);
    }
    const platformWallet = info.platformWallet as `0x${string}`;
    const usdcContract = info.usdcContract as `0x${string}`;

    // ── Chain switch ──
    // MODULAR: explicit switch before signing. Some wallets
    // (MetaMask, WalletConnect) drop the pending writeContract
    // request when the user switches chains mid-flow. Switching
    // first then signing avoids a "click submit twice" UX. If the
    // user is already on Arc, this is a no-op. Pass
    // ARC_TESTNET_ID directly (not the dynamically-parsed
    // targetChainId) because the runtime guard above guarantees
    // they're equal — and the wagmi Register augmentation picks
    // up ARC_TESTNET_ID as a literal-union chain ID, which keeps
    // the call fully type-safe without an `as` cast.
    if (chainId !== targetChainId) {
      setPhase({ phase: "switching_chain", targetChainId: ARC_TESTNET_ID });
      try {
        await switchChainAsync({ chainId: ARC_TESTNET_ID });
      } catch (err) {
        const message = describePaymentError(err);
        setPhase({ phase: "error", message: `Switch to Arc testnet (chain ${ARC_TESTNET_ID}) to continue: ${message}` });
        throw new Error(`Switch to Arc testnet (chain ${ARC_TESTNET_ID}) to continue: ${message}`);
      }
    }

    // ── ERC-20 transfer ──
    // MODULAR: wallets render "Transfer 0.5 USDC to <platformWallet>"
    // because they're decoding the ABI — much friendlier than a
    // raw sendTransaction with encoded calldata ("Unknown contract
    // interaction"). viem's writeContractAsync handles:
    //   - ABI encoding (same selector as the encodeErc20Transfer
    //     helper, byte-for-byte identical to a hand-rolled call)
    //   - chainId routing (the args.chainId below pins the call to
    //     Arc regardless of connected chain — belt + suspenders with
    //     the explicit switch above)
    //   - gas estimation defaults (EIP-1559)
    // MODULAR: parseAmountToMicroUsdc comes from src/lib/x402.ts
    // (single canonical implementation across the codebase — the
    // x402 tip route uses the same helper, so server + client +
    // tip flow all agree on USDC precision).
    let amountMicro: bigint;
    try {
      amountMicro = parseAmountToMicroUsdc(feeAmountUsdc);
    } catch (err) {
      const message = `Bad fee amount: ${feeAmountUsdc}`;
      setPhase({ phase: "error", message });
      throw new Error(`${message}: ${(err as Error).message}`);
    }

    setPhase({ phase: "awaiting_wallet_sign" });
    let txHash: Hex;
    try {
      txHash = await writeContractAsync({
        address: usdcContract,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [platformWallet, amountMicro],
        chainId: ARC_TESTNET_ID,
      });
    } catch (err) {
      const message = describePaymentError(err);
      setPhase({ phase: "error", message });
      throw new Error(message);
    }

    setPhase({ phase: "broadcasting", txHash });

    // ── 1-block confirmation wait ──
    // SAFE: writeContractAsync only confirms the wallet returned a
    // hash to the user — the tx can still be:
    //   - rejected by the mempool (reverts / nonce too low / gas
    //     underpriced)
    //   - pending for >N blocks
    //   - dropped on a reorg
    // If we resolve here and the form fires verifyPayment, the
    // server queries Arc RPC's txpool and gets "tx not yet
    // visible" → retry storm + panic toasts. Wagging for 1
    // confirmation eliminates the race by construction: by the
    // time the form knows the txHash, it's already in a mined
    // block on Arc.
    //
    // wagmi's waitForTransactionReceipt polls viem via the public
    // client and resolves with the full TransactionReceipt. We
    // pin chainId so wagmi routes to the right publicClient
    // (multi-chain config w/ mainnet + base + etc).
    //
    // Timeout behavior: viem throws `TimeoutError` after
    // SUBMIT_RECEIPT_TIMEOUT_MS of polling. We map it to a
    // readable "Receipt for tx <hash> not confirmed within 60s"
    // message and throw — the form's catch block surfaces the
    // toast, and retryVerifyPayment's lastTxHash cache re-uses
    // the same txHash so the verify endpoint eventually sees it
    // (the tx is likely on-chain, just RPC-laggy).
    //
    // Note we import `wagmiConfig` directly (module-level stable
    // singleton from createConfig({...}, { ssr: true })) rather
    // than useConfig() to keep the deps array dependency-free.
    try {
      await waitForTransactionReceipt(wagmiConfig, {
        hash: txHash,
        confirmations: 1,
        chainId: ARC_TESTNET_ID,
        timeout: SUBMIT_RECEIPT_TIMEOUT_MS,
      });
    } catch (err) {
      const friendly =
        err instanceof Error && /timeout/i.test(err.message)
          ? `Arc didn't confirm tx ${txHash} within ${SUBMIT_RECEIPT_TIMEOUT_MS / 1000}s. The tx may have landed but Arc RPC is lagging — try verifying again.`
          : describePaymentError(err);
      // MODULAR: carry the in-flight txHash on the error phase so
      // the form's retryVerifyPayment can re-verify the same hash
      // against the server (which will eventually see the tx once
      // Arc's mempool catches up) instead of forcing the user to
      // sign-and-pay a brand-new tx. This is the receipt-timeout
      // case specifically — writeContract/switchChain errors below
      // never reach this branch so they correctly stay hash-less.
      setPhase({ phase: "error", message: friendly, txHash });
      throw new Error(friendly);
    }

    // MODULAR: real-broadcast path returns the chain ID the hook
    // actually settled on — same value we validated against
    // ARC_TESTNET_ID above. The form uses this for the
    // payment_tx_broadcast analytics event so the funnel has
    // honest metadata (not a hardcoded constant that drifts if a
    // future operator runs Arc mainnet or another supported chain).
    // mockReason: null distinguishes "real on-chain tx" from
    // "mock fallback for any reason" for ops dashboards.
    return { txHash, mocked: false, chainId: targetChainId, mockReason: null };
  }, [address, chainId, feeAmountUsdc, isConnected, switchChainAsync, writeContractAsync]);

  const reset = useCallback(() => setPhase({ phase: "idle" }), []);

  return { phase, sendPayment, reset, arcInfo };
}

// MODULAR: re-exported for the form's status banner so it can
// render the testnet chain ID without duplicating the constant.
export { ARC_TESTNET_ID };
