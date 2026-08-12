// MODULAR: nanotip batch settlement. Verified x402 proofs are the
// queue (status 'verified'); this service aggregates them per artist
// and settles each batch as ONE on-chain USDC transfer from the
// platform custodial wallet via the arc adapter. No external batching
// API — the multi-step flow is: signed offer → verified proof row →
// per-artist aggregation → arc.sendTransfer → rows flipped 'settled'
// with the shared tx hash.
//
// CLEAN: a failed send leaves rows 'verified' so the sweeper retries
// them on the next /api/cron/sweep tick; the audit trail never claims
// settlement that didn't happen.

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { x402Proofs } from '../lib/schema';
import { emit } from '../lib/event-bus';
import { log } from '../lib/logger';
import type { ArcAdapter } from '../adapters/arc';
import { fromMicroUsdc } from './settlement';

export interface TipSettleResult {
  status: 'settled' | 'queued';
  hash: string | null;
  settledCount: number;
  amountMicroUsdc: string;
  mock: boolean;
}

export interface TipSettlementService {
  /** Aggregate all queued tips for one artist and settle them in a single transfer. */
  settleQueuedFor: (artistWallet: string) => Promise<TipSettleResult>;
  /** Settle every artist with queued tips (sweeper entry point). */
  flushAll: () => Promise<{ artists: number; settled: number }>;
  getTipStatus: (puid: string) => Promise<{ status: 'queued' | 'settled' | 'failed' | 'unknown'; hash: string | null }>;
}

export function createTipSettlementService({
  arc,
  platformWallet = null,
}: {
  arc: ArcAdapter;
  platformWallet?: string | null;
}): TipSettlementService {
  async function settleQueuedFor(artistWallet: string): Promise<TipSettleResult> {
    const queued = await db
      .select({ id: x402Proofs.id, amountMicroUsdc: x402Proofs.amountMicroUsdc })
      .from(x402Proofs)
      .where(and(eq(x402Proofs.artistWallet, artistWallet), eq(x402Proofs.status, 'verified')));
    return settleRows(artistWallet, queued);
  }

  async function settleRows(
    artistWallet: string,
    rows: Array<{ id: string; amountMicroUsdc: string }>,
  ): Promise<TipSettleResult> {
    if (rows.length === 0) {
      return { status: 'queued', hash: null, settledCount: 0, amountMicroUsdc: '0', mock: false };
    }
    const totalMicro = rows.reduce((sum, r) => sum + BigInt(r.amountMicroUsdc), 0n);
    const amountUsdc = fromMicroUsdc(totalMicro);
    try {
      const r = await arc.sendTransfer({
        from: platformWallet || '',
        to: artistWallet,
        amountUsdc,
      });
      await db
        .update(x402Proofs)
        .set({ status: 'settled', txHash: r.hash, settledAt: new Date() })
        .where(inArray(x402Proofs.id, rows.map((row) => row.id)));
      const settlementTimestamp = new Date().toISOString();
      // Canonical receipt stream: one transfer settled the whole batch.
      emit('settlement-event', {
        type: 'settled',
        source: 'tip',
        settlementId: r.hash,
        toWallet: artistWallet,
        artistWallet,
        amountUsdc,
        txHash: r.hash,
        settledCount: rows.length,
        mock: !!r.mock,
        timestamp: settlementTimestamp,
      });
      // Backward-compatible economy activity for existing clients.
      emit('economy-event', {
        kind: 'tip_batch_settled',
        settlementId: r.hash,
        toWallet: artistWallet,
        amountUsdc,
        txHash: r.hash,
        settledCount: rows.length,
        mock: !!r.mock,
        timestamp: settlementTimestamp,
      });
      return {
        status: 'settled',
        hash: r.hash,
        settledCount: rows.length,
        amountMicroUsdc: totalMicro.toString(),
        mock: !!r.mock,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('tip batch settle failed; leaving proofs queued', {
        artistWallet,
        count: rows.length,
        err: msg,
      });
      return {
        status: 'queued',
        hash: null,
        settledCount: 0,
        amountMicroUsdc: totalMicro.toString(),
        mock: false,
      };
    }
  }

  return {
    settleQueuedFor,

    async flushAll() {
      const queued = await db
        .select({
          id: x402Proofs.id,
          artistWallet: x402Proofs.artistWallet,
          amountMicroUsdc: x402Proofs.amountMicroUsdc,
        })
        .from(x402Proofs)
        .where(eq(x402Proofs.status, 'verified'));
      const byArtist = new Map<string, Array<{ id: string; amountMicroUsdc: string }>>();
      for (const row of queued) {
        const list = byArtist.get(row.artistWallet) ?? [];
        list.push({ id: row.id, amountMicroUsdc: row.amountMicroUsdc });
        byArtist.set(row.artistWallet, list);
      }
      let settled = 0;
      for (const [artist, rows] of byArtist) {
        const result = await settleRows(artist, rows);
        settled += result.settledCount;
      }
      return { artists: byArtist.size, settled };
    },

    async getTipStatus(puid: string) {
      const [row] = await db
        .select({ status: x402Proofs.status, txHash: x402Proofs.txHash })
        .from(x402Proofs)
        .where(eq(x402Proofs.puid, puid))
        .limit(1);
      if (!row) return { status: 'unknown' as const, hash: null };
      if (row.status === 'settled') return { status: 'settled' as const, hash: row.txHash };
      if (row.status === 'failed') return { status: 'failed' as const, hash: row.txHash };
      return { status: 'queued' as const, hash: null };
    },
  };
}
