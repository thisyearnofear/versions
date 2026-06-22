// MODULAR: Settlement service. insertLegsAtomic (atomic via single-statement
// inserts) + settleLegsAsync (calls arc, outside any DB transaction).
// DRY: every settlement_legs write goes through here.
// CLEAN: arc calls happen sequentially; a slow chain doesn't hold a lock.
//
// CONSOLIDATION (Phase 1): the musicbrainz leg routes to the
// submission's artist_wallet. The musicbrainzResolver hook is
// removed; the musicbrainz adapter is no longer imported; the audius
// adapter is gone. The leg label stays 'musicbrainz' so the audit
// trail reads "this was the artist's attribution leg".

import { randomUUID } from 'crypto';
import { eq, sql, desc, and } from 'drizzle-orm';
import { db } from '../lib/db';
import { submissions as submissionsTable, settlementLegs as legsTable } from '../lib/schema';
import type { SettlementStatus, RecipientRole } from '../lib/types';
import type { ArcAdapter } from '../adapters/arc';

export const SPLITS = Object.freeze({
  curator: 0.70,
  platform: 0.20,
  musicbrainz: 0.10,
});

export function toMicroUsdc(decimalString: string): bigint {
  if (typeof decimalString !== 'string') throw new Error('fee must be a string');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimalString);
  if (!m) throw new Error('fee must be a decimal string');
  const whole = m[1];
  const frac = (m[2] || '').padEnd(6, '0').slice(0, 6);
  return BigInt(whole) * BigInt(1000000) + BigInt(frac);
}

export function fromMicroUsdc(micro: bigint): string {
  const s = micro.toString().padStart(7, '0');
  const whole = s.slice(0, -6) || '0';
  const frac = s.slice(-6).replace(/0+$/, '') || '0';
  return frac === '0' ? `${whole}` : `${whole}.${frac}`;
}

export interface BuiltLeg {
  id: string;
  submission_id: string;
  recipient_wallet: string;
  recipient_role: RecipientRole;
  amount_usdc: string;
  status: SettlementStatus;
  created_at: string;
}

export function buildLegs({
  submissionId,
  feeQuoteUsdc,
  curatorWallets,
  platformWallet,
  musicbrainzWallet,
}: {
  submissionId: string;
  feeQuoteUsdc: string;
  curatorWallets: string[];
  platformWallet: string;
  musicbrainzWallet: string;
}): BuiltLeg[] {
  if (!submissionId) throw new Error('submissionId is required');
  if (!platformWallet) throw new Error('platformWallet is required');
  if (!musicbrainzWallet) throw new Error('musicbrainzWallet is required');
  const feeMicro = toMicroUsdc(feeQuoteUsdc);

  const curatorMicroTotal =
    (feeMicro * BigInt(Math.floor(SPLITS.curator * 1000000))) / BigInt(1000000);
  const platformMicro =
    (feeMicro * BigInt(Math.floor(SPLITS.platform * 1000000))) / BigInt(1000000);
  const musicbrainzMicro = feeMicro - curatorMicroTotal - platformMicro;

  const nowIso = new Date().toISOString();
  const legs: BuiltLeg[] = [];
  if (curatorWallets.length > 0) {
    const baseCurator = curatorMicroTotal / BigInt(curatorWallets.length);
    const remainder = curatorMicroTotal - baseCurator * BigInt(curatorWallets.length);
    curatorWallets.forEach((wallet, idx) => {
      const amount = baseCurator + (idx === 0 ? remainder : BigInt(0));
      legs.push({
        id: randomUUID(),
        submission_id: submissionId,
        recipient_wallet: wallet,
        recipient_role: 'curator',
        amount_usdc: fromMicroUsdc(amount),
        status: 'pending',
        created_at: nowIso,
      });
    });
  }
  legs.push({
    id: randomUUID(),
    submission_id: submissionId,
    recipient_wallet: platformWallet,
    recipient_role: 'platform',
    amount_usdc: fromMicroUsdc(platformMicro),
    status: 'pending',
    created_at: nowIso,
  });
  legs.push({
    id: randomUUID(),
    submission_id: submissionId,
    recipient_wallet: musicbrainzWallet,
    recipient_role: 'musicbrainz',
    amount_usdc: fromMicroUsdc(musicbrainzMicro),
    status: 'pending',
    created_at: nowIso,
  });
  return legs;
}

export type LegRow = typeof legsTable.$inferSelect;

export interface SettleLegResult {
  leg_id: string;
  status: string;
  tx_hash?: string;
  mock?: boolean;
  error?: string;
}

export interface EarningsByRole {
  role: RecipientRole;
  total: number;
  leg_count: number;
}

export interface RecentEarning {
  id: string;
  submission_id: string;
  role: RecipientRole;
  amount: string;
  settled_at: Date | null;
  submission_title: string | null;
  artist_name: string | null;
}

export interface EarningsReport {
  wallet: string;
  total: number;
  by_role: EarningsByRole[];
  recent: RecentEarning[];
}

export interface SettlementService {
  splits: typeof SPLITS;
  insertLegsAtomic: (args: {
    submissionId: string;
    feeQuoteUsdc: string;
    curatorWallets: string[];
    musicbrainzWallet: string;
  }) => Promise<BuiltLeg[]>;
  settleLegsAsync: (legIds: string[]) => Promise<SettleLegResult[]>;
  splitFee: (submissionId: string) => Promise<
    | { ok: true; legs: LegRow[]; settle_results: SettleLegResult[] }
    | { ok: false; error: string }
  >;
  getLegsForSubmission: (submissionId: string) => Promise<LegRow[]>;
  sumSettledFor: (wallet: string) => Promise<number>;
  listEarnings: (wallet: string, opts?: { limit?: number }) => Promise<EarningsReport>;
}

export function createSettlementService({
  arc = null,
  platformWallet = null,
}: {
  arc?: ArcAdapter | null;
  platformWallet?: string | null;
} = {}): SettlementService {
  return {
    splits: SPLITS,

    /**
     * Sync (was): insert the legs for a submission as 'pending'.
     * Now: a single multi-row insert keeps things close to atomic on
     * Neon — Postgres treats it as one statement.
     */
    async insertLegsAtomic({ submissionId, feeQuoteUsdc, curatorWallets, musicbrainzWallet }) {
      if (!musicbrainzWallet) {
        throw new Error('musicbrainzWallet is required (pass submission.artist_wallet)');
      }
      const [sub] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);
      if (!sub) throw new Error('Submission not found');
      const legs = buildLegs({
        submissionId,
        feeQuoteUsdc,
        curatorWallets,
        platformWallet: platformWallet || sub.artistWallet,
        musicbrainzWallet,
      });
      if (legs.length === 0) return [];
      await db.insert(legsTable).values(
        legs.map((l) => ({
          id: l.id,
          submissionId: l.submission_id,
          recipientWallet: l.recipient_wallet,
          recipientRole: l.recipient_role,
          amountUsdc: l.amount_usdc,
          status: l.status,
        })),
      );
      return legs;
    },

    /**
     * Async: drive each pending leg to 'settled' via arc.sendTransfer.
     */
    async settleLegsAsync(legIds: string[]): Promise<SettleLegResult[]> {
      if (!arc) throw new Error('arc adapter is required for settleLegsAsync');
      const results: SettleLegResult[] = [];
      for (const legId of legIds) {
        const [leg] = await db
          .select()
          .from(legsTable)
          .where(eq(legsTable.id, legId))
          .limit(1);
        if (!leg) {
          results.push({ leg_id: legId, status: 'missing' });
          continue;
        }
        if (leg.status === 'settled') {
          results.push({ leg_id: legId, status: 'settled', tx_hash: leg.txHash ?? undefined });
          continue;
        }
        try {
          const r = await arc.sendTransfer({
            from: platformWallet || '',
            to: leg.recipientWallet,
            amountUsdc: leg.amountUsdc,
          });
          await db
            .update(legsTable)
            .set({
              txHash: r.hash,
              settledAt: new Date(),
              status: 'settled',
            })
            .where(eq(legsTable.id, legId));
          results.push({ leg_id: legId, status: 'settled', tx_hash: r.hash, mock: !!r.mock });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db
            .update(legsTable)
            .set({ status: 'failed' })
            .where(eq(legsTable.id, legId));
          results.push({ leg_id: legId, status: 'failed', error: msg });
        }
      }
      return results;
    },

    async splitFee(submissionId: string) {
      const { ratings: ratingsSubTable } = await import('../lib/schema');
      const [sub] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);
      if (!sub) return { ok: false as const, error: 'Submission not found' };
      if (sub.status !== 'published') {
        return { ok: false as const, error: `Cannot settle submission in status ${sub.status}` };
      }
      const distinctCurators = await db
        .select({
          curator_wallet: ratingsSubTable.curatorWallet,
          first_at: sql<Date>`MIN(${ratingsSubTable.submittedAt})`,
        })
        .from(ratingsSubTable)
        .where(eq(ratingsSubTable.submissionId, submissionId))
        .groupBy(ratingsSubTable.curatorWallet)
        .orderBy(sql`MIN(${ratingsSubTable.submittedAt}), MIN(${ratingsSubTable.id})`);
      const curatorWallets = distinctCurators.map((r) => r.curator_wallet);
      const legs = await this.insertLegsAtomic({
        submissionId,
        feeQuoteUsdc: sub.feeQuoteUsdc,
        curatorWallets,
        musicbrainzWallet: sub.artistWallet,
      });
      const settleResults = await this.settleLegsAsync(legs.map((l) => l.id));
      const finalLegs = await this.getLegsForSubmission(submissionId);
      return { ok: true as const, legs: finalLegs, settle_results: settleResults };
    },

    async getLegsForSubmission(submissionId: string): Promise<LegRow[]> {
      return db
        .select()
        .from(legsTable)
        .where(eq(legsTable.submissionId, submissionId))
        .orderBy(legsTable.recipientRole, legsTable.id);
    },

    async sumSettledFor(wallet: string): Promise<number> {
      const [row] = await db
        .select({
          total: sql<string | null>`COALESCE(SUM(CAST(${legsTable.amountUsdc} AS NUMERIC)), 0)`,
        })
        .from(legsTable)
        .where(and(eq(legsTable.recipientWallet, wallet), eq(legsTable.status, 'settled')));
      return row ? Number(row.total ?? 0) : 0;
    },

    async listEarnings(wallet: string, { limit = 50 } = {}): Promise<EarningsReport> {
      const byRoleRows = await db
        .select({
          role: legsTable.recipientRole,
          total: sql<string>`COALESCE(SUM(CAST(${legsTable.amountUsdc} AS NUMERIC)), 0)`,
          leg_count: sql<number>`COUNT(*)::int`,
        })
        .from(legsTable)
        .where(and(eq(legsTable.recipientWallet, wallet), eq(legsTable.status, 'settled')))
        .groupBy(legsTable.recipientRole)
        .orderBy(sql`SUM(CAST(${legsTable.amountUsdc} AS NUMERIC)) DESC`);

      const [totalRow] = await db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${legsTable.amountUsdc} AS NUMERIC)), 0)`,
        })
        .from(legsTable)
        .where(and(eq(legsTable.recipientWallet, wallet), eq(legsTable.status, 'settled')));

      const recentRows = await db
        .select({
          id: legsTable.id,
          submission_id: legsTable.submissionId,
          role: legsTable.recipientRole,
          amount: legsTable.amountUsdc,
          settled_at: legsTable.settledAt,
          submission_title: submissionsTable.title,
          artist_name: submissionsTable.artistName,
        })
        .from(legsTable)
        .leftJoin(submissionsTable, eq(submissionsTable.id, legsTable.submissionId))
        .where(and(eq(legsTable.recipientWallet, wallet), eq(legsTable.status, 'settled')))
        .orderBy(desc(legsTable.settledAt))
        .limit(limit);

      return {
        wallet,
        total: Number(totalRow?.total ?? 0),
        by_role: byRoleRows.map((r) => ({
          role: r.role as RecipientRole,
          total: Number(r.total ?? 0),
          leg_count: Number(r.leg_count ?? 0),
        })),
        recent: recentRows.map((r) => ({
          id: r.id,
          submission_id: r.submission_id,
          role: r.role as RecipientRole,
          amount: r.amount,
          settled_at: r.settled_at,
          submission_title: r.submission_title,
          artist_name: r.artist_name,
        })),
      };
    },
  };
}

