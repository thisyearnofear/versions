"use client";

// MODULAR: TipButton — client-side surface for x402 sub-cent USDC
// nanopayments on Arc. The two-shot protocol (402 → sign → retry)
// is encapsulated here so callers just see "tip the artist N
// leptons".
//
// CLEAN: uses wagmi's useSignTypedData to sign the EIP-712 offer
//        exactly as the server built it. Re-uses x402 types from
//        @/lib/x402 so client + server agree byte-for-byte.
//
// PERFORMANT: no extra fetches on initial render — the recipient
//             hover-card lazy-loads on mouseenter with a 250 ms
//             debounce, an AbortController cancel-on-leave, and a
//             ref-keyed wallet cache so repeat hovers are free.
//
// ENHANCEMENT: the hover-card surfaces the SAME evidence the
//              listener is about to fund — last 3 published
//              versions + last 5 x402 tips + footer totals — so
//              the tip → recipient trust loop is visible in one
//              glance without leaving the feed.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSignTypedData, useAccount } from 'wagmi';
import { getAddress } from 'viem';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { apiClient, type ArtistTipCardResponse } from '@/lib/api-client';
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

// MODULAR: short peer label for tip-per-row "0x1234…abcd" rendering.
// Centralized so wallet addresses look consistent across surfaces.
function shortWallet(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// MODULAR: relative-time formatter for the tip-row timestamps.
// Three buckets — < 60 m ("Xm ago"), < 24 h ("Xh ago"), else
// M/D. Mirrors AgentMonitor's humanRelativeTime so a tip row and
// an adjacent verdict row read at the same scale.
function tipRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'just now';
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function TipButton({ artistWallet, artistName, variant = 'inline', onSettled }: TipButtonProps) {
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');

  // ── Hover-card state + refs ─────────────────────────────────
  // MODULAR: hover-driven fetch with delay + abort + per-wallet
  // cache so re-hovers during a feed scroll are free. Cache is a
  // ref (not state) so cache misses don't trigger re-renders —
  // only the actual card data does.
  const [cardOpen, setCardOpen] = useState(false);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardData, setCardData] = useState<ArtistTipCardResponse | null>(null);
  const cacheRef = useRef<Map<string, ArtistTipCardResponse>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // MODULAR: viewport-overflow guard. When the wrapper sits close
  // to the viewport bottom (mobile / long feed / zoom), the
  // ~280 px hover-card bleeds off-screen. We flip it to sit above
  // the button instead. Decision re-runs every card-open and on
  // window resize so orientation / zoom changes stay synced.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [flipAbove, setFlipAbove] = useState(false);

  // MODULAR: clear delay timer + abort fetch + close card on
  // mouseleave. The 250 ms open-delay on entry + synchronous
  // close on exit prevents the card flicker that would otherwise
  // happen on tooltip-style traversal across tight feed rows.
  const cancelHover = useCallback(() => {
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setCardOpen(false);
  }, []);

  const openHover = useCallback(() => {
    if (!isConnected) return;
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
    delayTimerRef.current = setTimeout(() => {
      delayTimerRef.current = null;
      setCardOpen(true);

      const cached = cacheRef.current.get(artistWallet);
      if (cached) {
        setCardData(cached);
        setCardLoading(false);
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setCardLoading(true);
      apiClient
        .getArtistTipCard(artistWallet)
        .then((data) => {
          if (ac.signal.aborted) return;
          cacheRef.current.set(artistWallet, data);
          setCardData(data);
          setCardLoading(false);
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          console.debug('[tip-button] card fetch failed:', (err as Error).message);
          setCardLoading(false);
        });
    }, 250);
  }, [artistWallet, isConnected]);

  // MODULAR: cleanup on unmount so an in-flight card fetch doesn't
  // resolve into a stale setter after the component is torn down.
  useEffect(() => {
    return () => {
      if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // ── LAYOUT EFFECT: viewport-overflow flip ──
  // MODULAR: viewport-overflow guard. Recomputes flipAbove when
  // the card opens + on resize + on scroll (viewport-relative
  // coordinates shift as the user scrolls — resize alone misses
  // it). Estimated card height raised to 320 px (was 280) so
  // worst-case wrapped artist names + 3 published + 5 tips +
  // footer still fit before flipping. useLayoutEffect over
  // useEffect so the swap paints in the same frame as cardOpen
  // toggling — no flash of wrong-side card. Touch-only devices
  // never fire mouseenter → cardOpen stays false → this stays
  // dormant; mobile surfaces use the artist page directly.
  useLayoutEffect(() => {
    if (!cardOpen || !wrapperRef.current || typeof window === 'undefined') return;
    const CARD_HEIGHT_ESTIMATE = 320;
    const recompute = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      setFlipAbove(spaceBelow < CARD_HEIGHT_ESTIMATE);
    };
    recompute();
    // MODULAR: rAF-debounced scroll handler so a wheel-event
    // flurry doesn't trigger N recomputes — at most one per
    // frame. Passive listener keeps the scroll smooth.
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        recompute();
      });
    };
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [cardOpen]);

  // MODULAR: when the parent posts a successful tip (via onSettled),
  // bust the wallet's cache entry so the next hover re-fetches with
  // the new tip in recent_tips. opt-in via prop; otherwise no-op.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const sendTip = useCallback(
    async (amountUsdc: string) => {
      if (!isConnected || !address) {
        showToast('Connect a wallet to tip the artist.', 'error');
        return;
      }
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
        const first = await fetch('/api/x402/tip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artistWallet, amountUsdc }),
        });
        const challengeHeader = first.headers.get('PAYMENT-REQUIRED');
        if (first.status !== 402 || !challengeHeader) {
          const json = await first.json().catch(() => ({}));
          throw new Error(json?.error?.message ?? `expected 402, got ${first.status}`);
        }
        const offer = decodeBase64<X402Offer>(challengeHeader);

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

        const proof: ProofHeader = { scheme: X402_SCHEME, signature, offer };
        const proofB64 = typeof window === 'undefined'
          ? Buffer.from(JSON.stringify(proof), 'utf8').toString('base64')
          : btoa(JSON.stringify(proof));

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

        // MODULAR: invalidate the cached card so the next hover re-
        // fetches with this tip in recent_tips. Cache stays cheap
        // because the per-wallet Map holds at most one entry per
        // artist the listener has tipped or hovered in this mount.
        cacheRef.current.delete(artistWallet);
        setCardData(null);

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
    // MODULAR: relative wrapper so the absoluted hover-card anchors
    // below the controls. onMouseEnter/Leave on the wrapper means
    // the card survives mouse travel from the buttons onto the
    // card itself (no flicker on the boundary). wrapperRef is
    // measured for the viewport-overflow flip decision above.
    <div
      ref={wrapperRef}
      className="relative inline-block"
      onMouseEnter={openHover}
      onMouseLeave={cancelHover}
      onFocusCapture={openHover}
      onBlurCapture={(e) => {
        // MODULAR: if focus leaves the wrapper entirely (not just
        // moves to a child button), close the card. nextTarget is
        // outside the wrapper when this is the case.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          cancelHover();
        }
      }}
    >
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
                'disabled:opacity-40 disabled:cursor-not-allowed transition-[transform,colors] duration-150 ease-out active:scale-[0.97]',
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
                className="font-mono text-[11px] uppercase tracking-[0.14em] px-2 py-1 border border-[var(--color-rust)] text-[var(--color-rust)] hover:bg-[var(--color-rust)] hover:text-[var(--color-paper)] transition-[transform,colors] duration-150 ease-out active:scale-[0.97]"
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

      {cardOpen && (
        <TipRecipientHoverCard
          artistWallet={artistWallet}
          artistName={artistName}
          loading={cardLoading}
          data={cardData}
          flipAbove={flipAbove}
        />
      )}
    </div>
  );
}

// ── Recipient hover-card ─────────────────────────────────

function TipRecipientHoverCard({
  artistWallet,
  artistName,
  loading,
  data,
  flipAbove,
}: {
  artistWallet: string;
  artistName?: string;
  loading: boolean;
  data: ArtistTipCardResponse | null;
  flipAbove: boolean;
}) {
  return (
    <div
      role="tooltip"
      aria-label={`Recipient card for ${artistName ?? artistWallet}`}
      className={cn(
        // MODULAR: anchor below-left of the wrapper by default — the
        // card's top edge aligns with the bottom of the button row.
        // When flipAbove is true (wrapper sits too close to viewport
        // bottom), anchor instead to bottom-full mb-2 so the card
        // paints ABOVE the wrapper. Decision re-renders inside
        // useLayoutEffect so the swap is paint-stable (no flash of
        // wrong-side card). Width reads at ~360 px on desktop; caps
        // at viewport width minus 2 rem so it never clips on narrow
        // screens. Raised z-index (50) so it sits above the feed
        // rows. The fade-in animation is 150 ms ease-out matching
        // the rest of the hover chrome across the app.
        'absolute z-50 left-0',
        flipAbove ? 'bottom-full mb-2' : 'top-full mt-2',
        'w-[min(360px,calc(100vw-2rem))] p-3 border border-[var(--color-hair-strong)]',
        'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-[2px_2px_0_rgba(26,26,26,0.12)]',
        'animate-in fade-in-0 duration-150',
      )}
      onMouseEnter={(e) => e.stopPropagation()}
    >
      {/* Eyebrow */}
      <div className="flex items-baseline justify-between gap-2 mb-2 pb-2 border-b border-[var(--color-hair)]">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)]">
          Recipient
        </span>
        <span
          className="font-mono text-[10px] text-[var(--color-ink-3)] truncate"
          title={artistWallet}
        >
          {shortWallet(artistWallet)}
        </span>
      </div>

      {/* Section A — recent published */}
      <section className="mb-3">
        <h4 className="font-mono text-[9px] uppercase tracking-[0.20em] text-[var(--color-ink-3)] mb-1.5">
          Last 3 published
        </h4>
        {loading && !data ? (
          <CardSkeleton rows={3} />
        ) : !data || data.recent_published.length === 0 ? (
          <p className="font-serif italic text-[12px] text-[var(--color-ink-3)] py-1">
            No published versions yet.
          </p>
        ) : (
          <ul className="flex flex-col">
            {data.recent_published.map((r) => (
              <li
                key={r.submission_id}
                className="flex items-baseline gap-2 py-1 border-b border-[var(--color-hair)] last:border-b-0"
              >
                <span className="font-serif text-[12px] font-medium truncate flex-1 min-w-0">
                  {r.title}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-2)] whitespace-nowrap">
                  {summarizeConsensus(r.energy_consensus, r.tempo_consensus)}
                </span>
                <span className="font-mono text-[9px] text-[var(--color-ink-3)] whitespace-nowrap tabular-nums">
                  {tipRelativeTime(r.published_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section B — recent tips */}
      <section className="mb-2">
        <h4 className="font-mono text-[9px] uppercase tracking-[0.20em] text-[var(--color-ink-3)] mb-1.5">
          Recent tips · last 5
        </h4>
        {loading && !data ? (
          <CardSkeleton rows={3} />
        ) : !data || data.recent_tips.length === 0 ? (
          <p className="font-serif italic text-[12px] text-[var(--color-ink-3)] py-1">
            Waiting for the first tip.
          </p>
        ) : (
          <ul className="flex flex-col">
            {data.recent_tips.map((t) => (
              <li
                key={t.puid}
                className="flex items-baseline gap-2 py-1 border-b border-[var(--color-hair)] last:border-b-0"
              >
                <span className="font-mono text-[11px] font-medium whitespace-nowrap tabular-nums">
                  ${t.amount_usdc}
                </span>
                <span
                  className="font-mono text-[9px] text-[var(--color-ink-2)] truncate"
                  title={t.tipper_wallet}
                >
                  {shortWallet(t.tipper_wallet)}
                </span>
                <span className="font-mono text-[9px] text-[var(--color-ink-3)] ml-auto whitespace-nowrap tabular-nums">
                  {tipRelativeTime(t.settled_at ?? t.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer — totals */}
      {data && data.total_tips > 0 && (
        <div className="flex items-baseline justify-between pt-2 border-t border-[var(--color-hair)]">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            {data.total_tips} {data.total_tips === 1 ? 'tip' : 'tips'} lifetime
          </span>
          <span className="font-mono text-[11px] font-medium tabular-nums text-[var(--color-rust)]">
            ${data.total_tips_usdc}
          </span>
        </div>
      )}
    </div>
  );
}

// MODULAR: collapse the energy/tempo consensus pair into a single
// compact breadcrumb. Reduces row width so the relative-time chip
// fits on the same line. Missing values fall back to "—" so an
// older version without a fresh aggregate doesn't blow up the row.
function summarizeConsensus(energy: string | null, tempo: string | null): string {
  const e = energy?.[0]?.toUpperCase() ?? '—';
  const t = tempo?.[0]?.toUpperCase() ?? '—';
  return `${e}/${t}`;
}

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="py-1.5">
          <div className="skel h-[10px] w-full max-w-[180px]" />
        </li>
      ))}
    </ul>
  );
}
