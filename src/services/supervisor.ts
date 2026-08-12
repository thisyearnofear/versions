// MODULAR: Supervisor dashboard service. Handles profiles, saved
// briefs, recent searches, and licensing interests for the B2B
// sync-first workflow.

import { randomUUID } from 'crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  users as usersTable,
  supervisorProfiles as profilesTable,
  savedBriefs as savedBriefsTable,
  briefSearches as briefSearchesTable,
  licensingInterests as interestsTable,
  matchFeedback as matchFeedbackTable,
  licenses as licensesTable,
  publishedVersions as pvTable,
} from '../lib/schema';
import { computeMatchBenchmark, type MatchBenchmarkReport, type MatchFeedbackVerdict } from '../lib/match-benchmark';
import { licenseFeeUsdc, type LicenseUsageType } from '../lib/pricing';

export type SupervisorRole = 'supervisor' | 'sync_house' | 'aandr';

export interface SupervisorProfileInput {
  wallet: string;
  email?: string | null;
  name?: string | null;
  company?: string | null;
  role?: SupervisorRole | null;
}

export interface SupervisorProfileRow {
  wallet: string;
  email: string | null;
  name: string | null;
  company: string | null;
  role: SupervisorRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedBriefInput {
  supervisorWallet: string;
  briefText: string;
  filters?: Record<string, unknown>;
}

export interface SavedBriefRow {
  id: string;
  supervisor_wallet: string;
  brief_text: string;
  filters: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface BriefSearchInput {
  supervisorWallet: string;
  briefText: string;
  filters?: Record<string, unknown>;
  resultsCount?: number;
}

export interface BriefSearchRow {
  id: string;
  supervisor_wallet: string;
  brief_text: string;
  filters: Record<string, unknown>;
  results_count: number;
  created_at: Date;
}

export interface LicensingInterestInput {
  supervisorWallet: string;
  submissionId: string;
  status?: 'interested' | 'contacted' | 'licensed' | 'passed';
  notes?: string;
}

export interface LicensingInterestRow {
  id: string;
  supervisor_wallet: string;
  submission_id: string;
  title?: string | null;
  artist_name?: string | null;
  artist_wallet?: string | null;
  status: 'interested' | 'contacted' | 'licensed' | 'passed';
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MatchFeedbackInput {
  supervisorWallet: string;
  briefHash: string;
  briefText: string;
  submissionId: string;
  fitScoreShown: number;
  rankShown?: number | null;
  verdict: MatchFeedbackVerdict;
}

export interface MatchFeedbackRow {
  id: string;
  supervisor_wallet: string;
  brief_hash: string;
  brief_text: string;
  submission_id: string;
  fit_score_shown: number;
  rank_shown: number | null;
  verdict: MatchFeedbackVerdict;
  created_at: Date;
  updated_at: Date;
}

export interface LicenseInput {
  supervisorWallet: string;
  submissionId: string;
  briefHash: string;
  briefText: string;
  usageType: LicenseUsageType;
}

export interface LicenseRow {
  id: string;
  supervisor_wallet: string;
  submission_id: string;
  brief_hash: string;
  brief_text: string;
  usage_type: LicenseUsageType;
  territory: string;
  term_months: number;
  fee_usdc: string;
  status: 'pending_payment' | 'paid';
  payment_tx_hash: string | null;
  payment_mock: boolean;
  job_id: string | null;
  job_status: string | null;
  deliverable_hash: string | null;
  job_create_tx_hash: string | null;
  job_complete_tx_hash: string | null;
  settled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  title?: string | null;
  artist_name?: string | null;
  artist_wallet?: string | null;
}

export interface SupervisorDashboardService {
  upsertProfile: (input: SupervisorProfileInput) => Promise<SupervisorProfileRow>;
  getProfile: (wallet: string) => Promise<SupervisorProfileRow | null>;
  saveBrief: (input: SavedBriefInput) => Promise<SavedBriefRow>;
  listSavedBriefs: (wallet: string, opts?: { limit?: number; offset?: number; search?: string }) => Promise<SavedBriefRow[]>;
  countSavedBriefs: (wallet: string, opts?: { search?: string }) => Promise<number>;
  deleteSavedBrief: (id: string, wallet: string) => Promise<{ ok: boolean }>;
  logSearch: (input: BriefSearchInput) => Promise<BriefSearchRow>;
  listRecentSearches: (wallet: string, opts?: { limit?: number; offset?: number; search?: string }) => Promise<BriefSearchRow[]>;
  countRecentSearches: (wallet: string, opts?: { search?: string }) => Promise<number>;
  addInterest: (input: LicensingInterestInput) => Promise<LicensingInterestRow>;
  updateInterest: (id: string, wallet: string, updates: Partial<Omit<LicensingInterestInput, 'supervisorWallet' | 'submissionId'>>) => Promise<LicensingInterestRow | null>;
  listInterests: (wallet: string, opts?: { limit?: number; offset?: number }) => Promise<LicensingInterestRow[]>;
  countInterests: (wallet: string) => Promise<number>;
  recordMatchFeedback: (input: MatchFeedbackInput) => Promise<MatchFeedbackRow>;
  listMatchFeedback: (wallet: string, opts?: { limit?: number; offset?: number }) => Promise<MatchFeedbackRow[]>;
  benchmarkMatchFeedback: () => Promise<MatchBenchmarkReport>;
  createLicense: (input: LicenseInput) => Promise<LicenseRow | null>;
  attachLicenseJob: (
    id: string,
    wallet: string,
    job: {
      jobId: string;
      jobStatus: string;
      deliverableHash: string;
      jobCreateTxHash: string | null;
    },
  ) => Promise<LicenseRow | null>;
  markLicensePaid: (
    id: string,
    wallet: string,
    payment: {
      txHash: string;
      mock: boolean;
      jobId?: string | null;
      jobStatus?: string | null;
      deliverableHash?: string | null;
      jobCreateTxHash?: string | null;
      jobCompleteTxHash?: string | null;
    },
  ) => Promise<LicenseRow | null>;
  getLicense: (id: string, wallet: string) => Promise<LicenseRow | null>;
  listLicenses: (wallet: string, opts?: { limit?: number; offset?: number }) => Promise<LicenseRow[]>;
  countLicenses: (wallet: string) => Promise<number>;
}

function rowToProfile(row: typeof profilesTable.$inferSelect): SupervisorProfileRow {
  return {
    wallet: row.wallet,
    email: row.email,
    name: row.name,
    company: row.company,
    role: (row.role as SupervisorRole) ?? 'supervisor',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToSavedBrief(row: typeof savedBriefsTable.$inferSelect): SavedBriefRow {
  return {
    id: row.id,
    supervisor_wallet: row.supervisorWallet,
    brief_text: row.briefText,
    filters: (row.filters as Record<string, unknown>) ?? {},
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function rowToBriefSearch(row: typeof briefSearchesTable.$inferSelect): BriefSearchRow {
  return {
    id: row.id,
    supervisor_wallet: row.supervisorWallet,
    brief_text: row.briefText,
    filters: (row.filters as Record<string, unknown>) ?? {},
    results_count: row.resultsCount,
    created_at: row.createdAt,
  };
}

// Escape Postgres ILIKE wildcards so user search input is treated literally.
// The ESCAPE clause below is PostgreSQL-specific; this service already targets Postgres.
function escapeLike(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function rowToInterest(
  row: typeof interestsTable.$inferSelect,
  version?: { title?: string | null; artistName?: string | null; artistWallet?: string | null },
): LicensingInterestRow {
  return {
    id: row.id,
    supervisor_wallet: row.supervisorWallet,
    submission_id: row.submissionId,
    title: version?.title ?? null,
    artist_name: version?.artistName ?? null,
    artist_wallet: version?.artistWallet ?? null,
    status: row.status as 'interested' | 'contacted' | 'licensed' | 'passed',
    notes: row.notes,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function rowToMatchFeedback(row: typeof matchFeedbackTable.$inferSelect): MatchFeedbackRow {
  return {
    id: row.id,
    supervisor_wallet: row.supervisorWallet,
    brief_hash: row.briefHash,
    brief_text: row.briefText,
    submission_id: row.submissionId,
    fit_score_shown: row.fitScoreShown,
    rank_shown: row.rankShown,
    verdict: row.verdict as MatchFeedbackVerdict,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function rowToLicense(
  row: typeof licensesTable.$inferSelect,
  version?: { title?: string | null; artistName?: string | null; artistWallet?: string | null },
): LicenseRow {
  return {
    id: row.id,
    supervisor_wallet: row.supervisorWallet,
    submission_id: row.submissionId,
    brief_hash: row.briefHash,
    brief_text: row.briefText,
    usage_type: row.usageType as LicenseUsageType,
    territory: row.territory,
    term_months: row.termMonths,
    fee_usdc: row.feeUsdc,
    status: row.status as 'pending_payment' | 'paid',
    payment_tx_hash: row.paymentTxHash,
    payment_mock: row.paymentMock,
    job_id: row.jobId ?? null,
    job_status: row.jobStatus ?? null,
    deliverable_hash: row.deliverableHash ?? null,
    job_create_tx_hash: row.jobCreateTxHash ?? null,
    job_complete_tx_hash: row.jobCompleteTxHash ?? null,
    settled_at: row.settledAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    title: version?.title ?? null,
    artist_name: version?.artistName ?? null,
    artist_wallet: version?.artistWallet ?? null,
  };
}

async function getVersionRow(submissionId: string) {
  const [row] = await db.select().from(pvTable).where(eq(pvTable.submissionId, submissionId)).limit(1);
  return row;
}

async function ensureUser(wallet: string) {
  const normalized = wallet.toLowerCase();
  await db
    .insert(usersTable)
    .values({
      id: randomUUID(),
      walletAddress: normalized,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: usersTable.walletAddress });
}

export function createSupervisorDashboardService(): SupervisorDashboardService {
  let service: SupervisorDashboardService;

  async function ensureProfile(wallet: string) {
    await ensureUser(wallet);
    const existing = await service.getProfile(wallet);
    if (existing) return existing;
    return service.upsertProfile({ wallet });
  }

  service = {
    async upsertProfile(input) {
      await ensureUser(input.wallet);
      const now = new Date();
      const [row] = await db
        .insert(profilesTable)
        .values({
          wallet: input.wallet.toLowerCase(),
          email: input.email ?? null,
          name: input.name ?? null,
          company: input.company ?? null,
          role: input.role ?? 'supervisor',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: profilesTable.wallet,
          set: {
            email: input.email ?? null,
            name: input.name ?? null,
            company: input.company ?? null,
            role: input.role ?? 'supervisor',
            updatedAt: now,
          },
        })
        .returning();
      return rowToProfile(row);
    },

    async getProfile(wallet) {
      const [row] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.wallet, wallet.toLowerCase()))
        .limit(1);
      return row ? rowToProfile(row) : null;
    },

    async saveBrief(input) {
      await ensureProfile(input.supervisorWallet);
      const [row] = await db
        .insert(savedBriefsTable)
        .values({
          id: randomUUID(),
          supervisorWallet: input.supervisorWallet.toLowerCase(),
          briefText: input.briefText,
          filters: input.filters ?? {},
        })
        .returning();
      return rowToSavedBrief(row);
    },

    async listSavedBriefs(wallet, { limit = 50, offset = 0, search } = {}) {
      const where = and(
        eq(savedBriefsTable.supervisorWallet, wallet.toLowerCase()),
        search ? sql`${savedBriefsTable.briefText} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'` : undefined,
      );
      const rows = await db
        .select()
        .from(savedBriefsTable)
        .where(where)
        .orderBy(desc(savedBriefsTable.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(rowToSavedBrief);
    },

    async countSavedBriefs(wallet, { search } = {}) {
      const where = and(
        eq(savedBriefsTable.supervisorWallet, wallet.toLowerCase()),
        search ? sql`${savedBriefsTable.briefText} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'` : undefined,
      );
      const [row] = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(savedBriefsTable)
        .where(where);
      return row?.count ?? 0;
    },

    async deleteSavedBrief(id, wallet) {
      const [row] = await db
        .delete(savedBriefsTable)
        .where(and(eq(savedBriefsTable.id, id), eq(savedBriefsTable.supervisorWallet, wallet.toLowerCase())))
        .returning();
      return { ok: !!row };
    },

    async logSearch(input) {
      await ensureProfile(input.supervisorWallet);
      const [row] = await db
        .insert(briefSearchesTable)
        .values({
          id: randomUUID(),
          supervisorWallet: input.supervisorWallet.toLowerCase(),
          briefText: input.briefText,
          filters: input.filters ?? {},
          resultsCount: input.resultsCount ?? 0,
        })
        .returning();
      return rowToBriefSearch(row);
    },

    async listRecentSearches(wallet, { limit = 20, offset = 0, search } = {}) {
      const where = and(
        eq(briefSearchesTable.supervisorWallet, wallet.toLowerCase()),
        search ? sql`${briefSearchesTable.briefText} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'` : undefined,
      );
      const rows = await db
        .select()
        .from(briefSearchesTable)
        .where(where)
        .orderBy(desc(briefSearchesTable.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(rowToBriefSearch);
    },

    async countRecentSearches(wallet, { search } = {}) {
      const where = and(
        eq(briefSearchesTable.supervisorWallet, wallet.toLowerCase()),
        search ? sql`${briefSearchesTable.briefText} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'` : undefined,
      );
      const [row] = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(briefSearchesTable)
        .where(where);
      return row?.count ?? 0;
    },

    async addInterest(input) {
      await ensureProfile(input.supervisorWallet);
      const [row] = await db
        .insert(interestsTable)
        .values({
          id: randomUUID(),
          supervisorWallet: input.supervisorWallet.toLowerCase(),
          submissionId: input.submissionId,
          status: input.status ?? 'interested',
          notes: input.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [interestsTable.supervisorWallet, interestsTable.submissionId],
          set: {
            status: input.status ?? 'interested',
            notes: input.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return rowToInterest(row);
    },

    async updateInterest(id, wallet, updates) {
      const [row] = await db
        .update(interestsTable)
        .set({
          status: updates.status,
          notes: updates.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(interestsTable.id, id), eq(interestsTable.supervisorWallet, wallet.toLowerCase())))
        .returning();
      return row ? rowToInterest(row) : null;
    },

    async listInterests(wallet, { limit = 50, offset = 0 } = {}) {
      const rows = await db
        .select({ interest: interestsTable, version: pvTable })
        .from(interestsTable)
        .leftJoin(pvTable, eq(interestsTable.submissionId, pvTable.submissionId))
        .where(eq(interestsTable.supervisorWallet, wallet.toLowerCase()))
        .orderBy(desc(interestsTable.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => rowToInterest(r.interest, r.version ?? undefined));
    },

    async countInterests(wallet) {
      const [row] = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(interestsTable)
        .where(eq(interestsTable.supervisorWallet, wallet.toLowerCase()));
      return row?.count ?? 0;
    },

    async recordMatchFeedback(input) {
      await ensureProfile(input.supervisorWallet);
      const now = new Date();
      const [row] = await db
        .insert(matchFeedbackTable)
        .values({
          id: randomUUID(),
          supervisorWallet: input.supervisorWallet.toLowerCase(),
          briefHash: input.briefHash,
          briefText: input.briefText,
          submissionId: input.submissionId,
          fitScoreShown: input.fitScoreShown,
          rankShown: input.rankShown ?? null,
          verdict: input.verdict,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [matchFeedbackTable.supervisorWallet, matchFeedbackTable.briefHash, matchFeedbackTable.submissionId],
          set: {
            fitScoreShown: input.fitScoreShown,
            rankShown: input.rankShown ?? null,
            verdict: input.verdict,
            updatedAt: now,
          },
        })
        .returning();
      return rowToMatchFeedback(row);
    },

    async listMatchFeedback(wallet, { limit = 100, offset = 0 } = {}) {
      const rows = await db
        .select()
        .from(matchFeedbackTable)
        .where(eq(matchFeedbackTable.supervisorWallet, wallet.toLowerCase()))
        .orderBy(desc(matchFeedbackTable.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(rowToMatchFeedback);
    },

    async benchmarkMatchFeedback() {
      const rows = await db.select().from(matchFeedbackTable).orderBy(asc(matchFeedbackTable.createdAt));
      return computeMatchBenchmark(
        rows.map((r) => ({
          briefHash: r.briefHash,
          submissionId: r.submissionId,
          fitScoreShown: r.fitScoreShown,
          rankShown: r.rankShown,
          verdict: r.verdict as MatchFeedbackVerdict,
        })),
      );
    },

    async createLicense(input) {
      await ensureProfile(input.supervisorWallet);
      const version = await getVersionRow(input.submissionId);
      if (!version) return null; // not a published take
      const fee = licenseFeeUsdc(input.usageType);
      const now = new Date();
      const [row] = await db
        .insert(licensesTable)
        .values({
          id: randomUUID(),
          supervisorWallet: input.supervisorWallet.toLowerCase(),
          submissionId: input.submissionId,
          briefHash: input.briefHash,
          briefText: input.briefText,
          usageType: input.usageType,
          territory: 'worldwide',
          termMonths: 12,
          feeUsdc: fee,
          status: 'pending_payment',
          paymentMock: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [licensesTable.supervisorWallet, licensesTable.submissionId, licensesTable.briefHash],
          set: {
            briefText: input.briefText,
            usageType: input.usageType,
            feeUsdc: fee,
            updatedAt: now,
          },
        })
        .returning();
      return rowToLicense(row, version);
    },

    async attachLicenseJob(id, wallet, job) {
      const now = new Date();
      const [row] = await db
        .update(licensesTable)
        .set({
          jobId: job.jobId,
          jobStatus: job.jobStatus,
          deliverableHash: job.deliverableHash,
          jobCreateTxHash: job.jobCreateTxHash,
          updatedAt: now,
        })
        .where(and(eq(licensesTable.id, id), eq(licensesTable.supervisorWallet, wallet.toLowerCase())))
        .returning();
      if (!row) return null;
      const version = await getVersionRow(row.submissionId);
      return rowToLicense(row, version ?? undefined);
    },

    async markLicensePaid(id, wallet, payment) {
      const now = new Date();
      const [row] = await db
        .update(licensesTable)
        .set({
          status: 'paid',
          paymentTxHash: payment.txHash,
          paymentMock: payment.mock,
          jobId: payment.jobId ?? undefined,
          jobStatus: payment.jobStatus ?? undefined,
          deliverableHash: payment.deliverableHash ?? undefined,
          jobCreateTxHash: payment.jobCreateTxHash ?? undefined,
          jobCompleteTxHash: payment.jobCompleteTxHash ?? undefined,
          settledAt: now,
          updatedAt: now,
        })
        .where(and(eq(licensesTable.id, id), eq(licensesTable.supervisorWallet, wallet.toLowerCase())))
        .returning();
      if (!row) return null;
      const version = await getVersionRow(row.submissionId);
      return rowToLicense(row, version ?? undefined);
    },

    async getLicense(id, wallet) {
      const [row] = await db
        .select({ license: licensesTable, version: pvTable })
        .from(licensesTable)
        .leftJoin(pvTable, eq(licensesTable.submissionId, pvTable.submissionId))
        .where(and(eq(licensesTable.id, id), eq(licensesTable.supervisorWallet, wallet.toLowerCase())))
        .limit(1);
      return row ? rowToLicense(row.license, row.version ?? undefined) : null;
    },

    async listLicenses(wallet, { limit = 50, offset = 0 } = {}) {
      const rows = await db
        .select({ license: licensesTable, version: pvTable })
        .from(licensesTable)
        .leftJoin(pvTable, eq(licensesTable.submissionId, pvTable.submissionId))
        .where(eq(licensesTable.supervisorWallet, wallet.toLowerCase()))
        .orderBy(desc(licensesTable.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => rowToLicense(r.license, r.version ?? undefined));
    },

    async countLicenses(wallet) {
      const [row] = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(licensesTable)
        .where(eq(licensesTable.supervisorWallet, wallet.toLowerCase()));
      return row?.count ?? 0;
    },
  };

  return service;
}
