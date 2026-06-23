// MODULAR: Listener incentive service.
// Free plays, reputation scoring, and badge awards drive engagement.
// Each listener gets N free plays per day (subsidized by the platform).
// After exhausting free plays, the standard $0.001 on-chain charge applies.
// Reputation unlocks curation weight and featured placement.
// Badges are milestone-based achievement rewards.

import { randomUUID } from 'crypto';
import { eq, sql, and, desc, gte, lte } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  listenerProfiles as profilesTable,
  listenerBadges as badgesTable,
  arPlayEvents as playEventsTable,
  publishedVersions as pvTable,
  arPlaylists as playlistsTable,
} from '../lib/schema';

// ── Constants ───────────────────────────────────────────

export const FREE_PLAYS_DAILY_LIMIT = 10;
export const REP_POINTS_FREE_PLAY = 1;
export const REP_POINTS_PAID_PLAY = 3;
export const REP_POINTS_DISTINCT_TRACK = 5;
export const REP_POINTS_FEEDBACK = 10;

export const BADGE_THRESHOLDS = {
  explorer: { label: 'Explorer', description: 'Listened to 10 different tracks', icon: '🎧', minDistinctTracks: 10 },
  supporter: { label: 'Supporter', description: '50 paid plays supporting artists', icon: '⭐', minPaidPlays: 50 },
  curator: { label: 'Curator', description: '100 plays across all genres', icon: '🎵', minTotalPlays: 100 },
  tastemaker: { label: 'Tastemaker', description: '500 plays — you have impeccable taste', icon: '👑', minTotalPlays: 500 },
  early_adopter: { label: 'Early Adopter', description: 'One of the first to discover VERSIONS', icon: '🔮', minTotalPlays: 1 },
} as const;

export type BadgeType = keyof typeof BADGE_THRESHOLDS;

// ── Response Types ──────────────────────────────────────

export interface ListenerProfile {
  wallet: string;
  reputationScore: number;
  freePlaysRemaining: number;
  freePlaysDailyLimit: number;
  freePlaysUsedToday: number;
  totalPlays: number;
  totalPaidPlays: number;
  totalFreePlays: number;
  distinctTracksPlayed: number;
  lastPlayedAt: string | null;
  badges: ListenerBadge[];
}

export interface ListenerBadge {
  id: string;
  badgeType: BadgeType;
  label: string;
  description: string;
  icon: string;
  awardedAt: string;
}

export interface FreePlayResult {
  free: boolean;
  remaining: number;
  reputationEarned: number;
  newBadges: ListenerBadge[];
}

export interface PlayHistoryEntry {
  id: string;
  versionId: string;
  playlistId: string;
  playlistName: string | null;
  title: string | null;
  artistName: string | null;
  listenerFeeUsdc: string;
  artistPayoutUsdc: string;
  playType: 'free' | 'paid';
  status: string;
  playedAt: string;
}

export interface PlayHistoryResult {
  rows: PlayHistoryEntry[];
  total: number;
}

export interface ListenerService {
  getProfile: (wallet: string) => Promise<ListenerProfile>;
  ensureProfile: (wallet: string) => Promise<ListenerProfile>;
  checkFreePlay: (wallet: string) => Promise<{ free: boolean; remaining: number }>;
  recordPlay: (args: { wallet: string; versionId: string; playlistId: string }) => Promise<FreePlayResult>;
  checkAndAwardBadges: (wallet: string) => Promise<ListenerBadge[]>;
  getPlayHistory: (wallet: string, opts?: { limit?: number; offset?: number; playType?: string; status?: string; dateFrom?: string; dateTo?: string }) => Promise<PlayHistoryResult>;
}

// ── Helpers ─────────────────────────────────────────────

function isNewDay(lastReset: Date): boolean {
  const now = new Date();
  return (
    now.getUTCFullYear() > lastReset.getUTCFullYear() ||
    now.getUTCMonth() > lastReset.getUTCMonth() ||
    now.getUTCDate() > lastReset.getUTCDate()
  );
}

function resetDailyFreePlays(): { used: number; resetAt: Date } {
  return { used: 0, resetAt: new Date() };
}

// ── Service Factory ─────────────────────────────────────

export function createListenerService(): ListenerService {
  return {
    async getProfile(wallet: string): Promise<ListenerProfile> {
      const [profile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.wallet, wallet))
        .limit(1);

      if (!profile) {
        return {
          wallet,
          reputationScore: 0,
          freePlaysRemaining: FREE_PLAYS_DAILY_LIMIT,
          freePlaysDailyLimit: FREE_PLAYS_DAILY_LIMIT,
          freePlaysUsedToday: 0,
          totalPlays: 0,
          totalPaidPlays: 0,
          totalFreePlays: 0,
          distinctTracksPlayed: 0,
          lastPlayedAt: null,
          badges: [],
        };
      }

      // Check if daily counter needs resetting
      const freePlaysUsed = isNewDay(profile.lastFreePlayReset)
        ? 0
        : profile.freePlaysUsedToday;
      const freePlaysRemaining = Math.max(0, profile.freePlaysDailyLimit - freePlaysUsed);

      const badgeRows = await db
        .select()
        .from(badgesTable)
        .where(eq(badgesTable.wallet, wallet))
        .orderBy(desc(badgesTable.awardedAt));

      const badges: ListenerBadge[] = badgeRows.map((b) => {
        const badgeDef = BADGE_THRESHOLDS[b.badgeType as BadgeType] ?? {
          label: b.badgeType,
          description: '',
          icon: '🏅',
        };
        return {
          id: b.id,
          badgeType: b.badgeType as BadgeType,
          label: badgeDef.label,
          description: badgeDef.description,
          icon: badgeDef.icon,
          awardedAt: b.awardedAt.toISOString(),
        };
      });

      return {
        wallet: profile.wallet,
        reputationScore: profile.reputationScore,
        freePlaysRemaining,
        freePlaysDailyLimit: profile.freePlaysDailyLimit,
        freePlaysUsedToday: freePlaysUsed,
        totalPlays: profile.totalPlays,
        totalPaidPlays: profile.totalPaidPlays,
        totalFreePlays: profile.totalFreePlays,
        distinctTracksPlayed: profile.distinctTracksPlayed,
        lastPlayedAt: profile.lastPlayedAt?.toISOString() ?? null,
        badges,
      };
    },

    async ensureProfile(wallet: string): Promise<ListenerProfile> {
      const [existing] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.wallet, wallet))
        .limit(1);

      if (existing) {
        // Reset daily counter if needed
        if (isNewDay(existing.lastFreePlayReset)) {
          const { used, resetAt } = resetDailyFreePlays();
          await db
            .update(profilesTable)
            .set({ freePlaysUsedToday: used, lastFreePlayReset: resetAt })
            .where(eq(profilesTable.wallet, wallet));
        }
        return this.getProfile(wallet);
      }

      // Create new profile
      await db.insert(profilesTable).values({
        wallet,
        reputationScore: 0,
        freePlaysUsedToday: 0,
        freePlaysDailyLimit: FREE_PLAYS_DAILY_LIMIT,
        lastFreePlayReset: new Date(),
        totalPlays: 0,
        totalPaidPlays: 0,
        totalFreePlays: 0,
        distinctTracksPlayed: 0,
      });

      // Award Early Adopter badge
      const badgeId = randomUUID();
      await db.insert(badgesTable).values({
        id: badgeId,
        wallet,
        badgeType: 'early_adopter',
      });

      return this.getProfile(wallet);
    },

    async checkFreePlay(wallet: string): Promise<{ free: boolean; remaining: number }> {
      const profile = await this.ensureProfile(wallet);
      const remaining = profile.freePlaysRemaining;
      return {
        free: remaining > 0,
        remaining,
      };
    },

    async recordPlay({ wallet, versionId, playlistId }) {
      // Ensure profile exists
      const profile = await this.ensureProfile(wallet);

      // Check if this is a free play
      const isFree = profile.freePlaysRemaining > 0;

      // Update profile stats
      const now = new Date();
      const freePlaysUsed = isFree ? profile.freePlaysUsedToday + 1 : profile.freePlaysUsedToday;
      const reputationBonus = isFree ? REP_POINTS_FREE_PLAY : REP_POINTS_PAID_PLAY;
      const totalPlays = profile.totalPlays + 1;
      const totalFreePlays = isFree ? profile.totalFreePlays + 1 : profile.totalFreePlays;
      const totalPaidPlays = !isFree ? profile.totalPaidPlays + 1 : profile.totalPaidPlays;

      // Check if this is a distinct track (not played before)
      // We check the play events table for this listener+version combo
      const existingPlays = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(playEventsTable)
        .where(
          and(
            eq(playEventsTable.listenerWallet, wallet),
            eq(playEventsTable.versionId, versionId),
          ),
        );
      const isDistinct = (existingPlays[0]?.count ?? 0) === 0;
      const distinctTracksPlayed = isDistinct
        ? profile.distinctTracksPlayed + 1
        : profile.distinctTracksPlayed;
      const totalReputation =
        profile.reputationScore + reputationBonus + (isDistinct ? REP_POINTS_DISTINCT_TRACK : 0);

      await db
        .update(profilesTable)
        .set({
          reputationScore: totalReputation,
          freePlaysUsedToday: freePlaysUsed,
          totalPlays,
          totalPaidPlays,
          totalFreePlays,
          distinctTracksPlayed,
          lastPlayedAt: now,
        })
        .where(eq(profilesTable.wallet, wallet));

      // Check and award new badges
      const newBadges = await this.checkAndAwardBadges(wallet);

      const remaining = Math.max(0, profile.freePlaysDailyLimit - freePlaysUsed);

      return {
        free: isFree,
        remaining,
        reputationEarned: reputationBonus + (isDistinct ? REP_POINTS_DISTINCT_TRACK : 0),
        newBadges,
      };
    },

    async getPlayHistory(wallet: string, { limit = 50, offset = 0, playType, status, dateFrom, dateTo } = {}): Promise<PlayHistoryResult> {
      const conditions = [eq(playEventsTable.listenerWallet, wallet)];
      if (playType) conditions.push(eq(playEventsTable.playType, playType));
      if (status) conditions.push(eq(playEventsTable.status, status));
      if (dateFrom) conditions.push(gte(playEventsTable.playedAt, new Date(dateFrom)));
      if (dateTo) conditions.push(lte(playEventsTable.playedAt, new Date(dateTo + 'T23:59:59.999Z')));

      const whereClause = and(...conditions);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(playEventsTable)
        .where(whereClause);

      const rows = await db
        .select({
          id: playEventsTable.id,
          versionId: playEventsTable.versionId,
          playlistId: playEventsTable.playlistId,
          playlistName: playlistsTable.name,
          title: pvTable.title,
          artistName: pvTable.artistName,
          listenerFeeUsdc: playEventsTable.listenerFeeUsdc,
          artistPayoutUsdc: playEventsTable.artistPayoutUsdc,
          playType: playEventsTable.playType,
          status: playEventsTable.status,
          playedAt: playEventsTable.playedAt,
        })
        .from(playEventsTable)
        .leftJoin(pvTable, eq(pvTable.submissionId, playEventsTable.versionId))
        .leftJoin(playlistsTable, eq(playlistsTable.id, playEventsTable.playlistId))
        .where(whereClause)
        .orderBy(desc(playEventsTable.playedAt))
        .limit(limit)
        .offset(offset);

      return {
        rows: rows.map((r) => ({
          id: r.id,
          versionId: r.versionId,
          playlistId: r.playlistId,
          playlistName: r.playlistName,
          title: r.title,
          artistName: r.artistName,
          listenerFeeUsdc: r.listenerFeeUsdc,
          artistPayoutUsdc: r.artistPayoutUsdc,
          playType: (r.playType as 'free' | 'paid') ?? 'paid',
          status: r.status,
          playedAt: r.playedAt.toISOString(),
        })),
        total: Number(count ?? 0),
      };
    },

    async checkAndAwardBadges(wallet: string): Promise<ListenerBadge[]> {
      const [profile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.wallet, wallet))
        .limit(1);

      if (!profile) return [];

      const existingBadges = await db
        .select({ badgeType: badgesTable.badgeType })
        .from(badgesTable)
        .where(eq(badgesTable.wallet, wallet));

      const ownedBadgeTypes = new Set(existingBadges.map((b) => b.badgeType));

      const newBadges: ListenerBadge[] = [];

      const badgeEntries = Object.entries(BADGE_THRESHOLDS) as Array<[BadgeType, typeof BADGE_THRESHOLDS[BadgeType]]>;

      for (const [badgeType, def] of badgeEntries) {
        if (ownedBadgeTypes.has(badgeType)) continue;
        if (badgeType === 'early_adopter') continue; // already awarded on profile creation

        let earned = false;
        switch (badgeType) {
          case 'explorer':
            earned = profile.distinctTracksPlayed >= (def as typeof BADGE_THRESHOLDS['explorer']).minDistinctTracks;
            break;
          case 'supporter':
            earned = profile.totalPaidPlays >= (def as typeof BADGE_THRESHOLDS['supporter']).minPaidPlays;
            break;
          case 'curator':
            earned = profile.totalPlays >= (def as typeof BADGE_THRESHOLDS['curator']).minTotalPlays;
            break;
          case 'tastemaker':
            earned = profile.totalPlays >= (def as typeof BADGE_THRESHOLDS['tastemaker']).minTotalPlays;
            break;
        }

        if (earned) {
          const id = randomUUID();
          await db.insert(badgesTable).values({
            id,
            wallet,
            badgeType,
          });
          newBadges.push({
            id,
            badgeType,
            label: def.label,
            description: def.description,
            icon: def.icon,
            awardedAt: new Date().toISOString(),
          });
        }
      }

      return newBadges;
    },
  };
}
