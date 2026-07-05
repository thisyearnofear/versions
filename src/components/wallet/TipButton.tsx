"use client";

// MODULAR: TipButton — the client-side surface for x402
// sub-cent USDC nanopayments on Arc.
//
// DRY: every tip the artist receives flows through this
//      component. The two-shot protocol (402 → sign → retry) is
//      encapsulated here so callers just see "tip the artist N
//      leptons".
//
// CLEAN: uses wagmi's useSignTypedData to sign the EIP-712
//        offer exactly as the server built it. Re-uses the
//        x402 types from @/lib/x402 so client and server agree
//        on the schema byte-for-byte.
//
// PERFORMANT: no extra fetches — the component reads the
//             challenge from the 402 response's PAYMENT-REQUIRED
//             header (the spec's canonical transport).

import { useCallback, useState } from 'react';
import { useSignTypedData, useAccount } from 'wagmi';
import { getAddress } from 'viem';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  X402_OFFER_TYPES,
  X402_VERSION,
  X402_SCHEME,
  type X402Offer,
  parseAmountToMicroUsdc,
  formatMicroUsdc,
} from '@/lib/x402';

export interface TipButtonProps {
  artistWallet: string;
  artistName?: string;
  variant?: 'inline' | 'block';
  onSettled?: (result: { hash: string; amountUsdc: string; mock: boolean }) => void;
}

interface PresetAmount {
  label: string;
  // amountUsdc as a decimal string, e.g. "0.000001" for 1 lepton
  amountUsdc: string;
  leptonCount: string;
}

const PRESETS: PresetAmount[] = [
  { label: '1 lepton', amountUsdc: '0.000001', leptonCount: '1' },
  { label: '1¢', amountUsdc: '0.01', leptonCount: '10,000' },
  { label: '5¢', amountUsdc: '0.05', leptonCount: '50,000' },
  { label: '25¢', amountUsdc: '0.25', leptonCount: '250,000' },
];

interface TipResponse {
  success: boolean;
  data?: {
    ok: boolean;
    hash: string;
    puid: string;
    status: string;
    mock: boolean;
    amountMicroUsdc: string;
    amountUsdc: string;
    tipperWallet: string;
    artistWallet: string;
    settledAt: string;
  };
  error?: { code: string; message: string; details?: unknown };
}

interface ProofHeader {
  scheme: string;
  signature: `0x${string}`;
  offer: X402Offer;
}

function decodeBase64<T>(b64: string): T {
  if (typeof window === 'undefined') {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as T;
  }
  return JSON.parse(atob(b64)) as T;
}

export function TipButton({ artistWallet, artistName, variant = 'inline', onSettled }: TipButtonProps) {
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');

  const sendTip = useCallback(
    async (amountUsdc: string) => {
      if (!isConnected || !address) {
        showToast('Connect a wallet to tip the artist.', 'error');
        return;
      }
      // MODULAR: client-side preflight amount check so we don't
      // burn a 402 round-trip on a bad amount. parseAmountToMicroUsdc
      // throws on bad input — catch and toast the user.
      let amountMicro: bigint;
      try {
        amountMicro = parseAmountToMicroUsdc(amountUsdc);
      } catch (err) {
        showToast(`Invalid amount: ${(err as Error).message}`, 'error');
        return;
      }
      if (amountMicro <= 0n) {
        showToast('Amount must be positive.', 'error');
        return;
      }
      if (amountMicro > 1_000_000n) {
        showToast('Per-tip cap is 1 USDC. Use a different surface for larger amounts.', 'error');
        return;
      }

      setBusy(true);
      try {
        // First call: get the 402 challenge.
        const first = await fetch('/api/x402/tip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artistWallet, amountUsdc }),
        });
        // CLEAN: the 402 carries the offer in the PAYMENT-REQUIRED
        // header. Read it from headers (not the JSON body) so the
        // spec's canonical transport is used.
        const challengeHeader = first.headers.get('PAYMENT-REQUIRED');
        if (first.status !== 402 || !challengeHeader) {
          const json = await first.json().catch(() => ({}));
          throw new Error(json?.error?.message ?? `expected 402, got ${first.status}`);
        }
        const offer = decodeBase64<X402Offer>(challengeHeader);

        // MODULAR: sign exactly the offer the server issued, on
        // the chain the wallet is connected to. wagmi fills the
        // EIP-712 domain from the connector.
        // - BigInt(amount) and BigInt(validUntil) because viem's
        //   uint256 fields expect bigint at the viem boundary.
        // - getAddress(payTo) because viem's address fields are
        //   strict-checksum-validated.
        // After the conversions the shape structurally matches
        // viem's inferred message type, so no cast is needed.
        const signature = await signTypedDataAsync({
          domain: {
            name: 'VERSIONS x402',
            version: X402_VERSION,
            chainId: chainId ?? 1,
          },
          types: X402_OFFER_TYPES,
          primaryType: 'Offer',
          message: {
            ...offer,
            amount: BigInt(offer.amount),
            validUntil: BigInt(offer.validUntil),
            payTo: getAddress(offer.payTo),
          },
        });

        // MODULAR: build the PAYMENT-SIGNATURE header. The spec
        // requires base64({scheme, signature, offer}). We re-encode
        // the offer verbatim so the server's offerMatches check
        // passes byte-for-byte.
        const proof: ProofHeader = { scheme: X402_SCHEME, signature, offer };
        const proofB64 = typeof window === 'undefined'
          ? Buffer.from(JSON.stringify(proof), 'utf8').toString('base64')
          : btoa(JSON.stringify(proof));

        // Second call: submit the signed proof.
        const second = await fetch('/api/x402/tip', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'PAYMENT-SIGNATURE': proofB64,
          },
          body: JSON.stringify({ artistWallet, amountUsdc }),
        });
        const json = (await second.json().catch(() => ({}))) as TipResponse;
        if (!second.ok || !json.success || !json.data) {
          throw new Error(json.error?.message ?? `tip failed (${second.status})`);
        }

        const niceAmount = `${formatMicroUsdc(BigInt(json.data.amountMicroUsdc))} ($${amountUsdc})`;
        showToast(
          `Tipped ${artistName ?? artistWallet} ${niceAmount}${json.data.mock ? ' (mock)' : ''}`,
          'success',
        );
        onSettled?.({ hash: json.data.hash, amountUsdc, mock: json.data.mock });
      } catch (err) {
        showToast(`Tip failed: ${(err as Error).message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [address, artistName, artistWallet, chainId, isConnected, onSettled, showToast, signTypedDataAsync],
  );

  const handleCustom = useCallback(() => {
    const trimmed = customAmount.trim();
    if (!trimmed) {
      showToast('Enter a USDC amount first.', 'error');
      return;
    }
    void sendTip(trimmed);
    setCustomOpen(false);
    setCustomAmount('');
  }, [customAmount, sendTip, showToast]);

  if (!isConnected) {
    return (
      <div
        className={cn(
          'border border-[var(--color-hair)] bg-[var(--color-paper-2)]/40 px-3 py-2',
          variant === 'block' && 'w-full',
        )}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Connect a wallet to tip
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border border-[var(--color-hair-strong)]',
        variant === 'block' ? 'p-4' : 'px-3 py-2',
      )}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)]">
          Tip
        </span>
        <span className="font-mono text-[10px] text-[var(--color-ink-3)]">
          {PRESETS[0].leptonCount} leptons · $0.000001 floor
        </span>
      </div>
      <div className={cn('flex flex-wrap gap-2', variant === 'block' && 'flex-col')}>
        {PRESETS.map((p) => (
          <button
            key={p.amountUsdc}
            type="button"
            disabled={busy}
            onClick={() => void sendTip(p.amountUsdc)}
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.14em] px-3 py-1.5 border',
              'border-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)]',
              'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
            )}
            title={`${p.leptonCount} leptons ($${p.amountUsdc} USDC)`}
          >
            {p.label}
          </button>
        ))}
        {customOpen ? (
          <span className="flex items-center gap-1">
            <input
              type="text"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="0.0001"
              className="font-mono text-[11px] w-20 px-2 py-1 border border-[var(--color-hair-strong)] bg-[var(--color-paper)]"
              inputMode="decimal"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCustom();
                if (e.key === 'Escape') {
                  setCustomOpen(false);
                  setCustomAmount('');
                }
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleCustom}
              className="font-mono text-[11px] uppercase tracking-[0.14em] px-2 py-1 border border-[var(--color-rust)] text-[var(--color-rust)] hover:bg-[var(--color-rust)] hover:text-[var(--color-paper)]"
            >
              Go
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomOpen(false);
                setCustomAmount('');
              }}
              className="font-mono text-[11px] px-2 py-1 text-[var(--color-ink-3)]"
            >
              ×
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setCustomOpen(true)}
            className="font-mono text-[11px] uppercase tracking-[0.14em] px-3 py-1.5 border border-[var(--color-hair-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-ink)]"
          >
            Custom
          </button>
        )}
      </div>
      {busy && (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] mt-2">
          Sign the prompt in your wallet…
        </p>
      )}
    </div>
  );
}
