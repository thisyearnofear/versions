// MODULAR: Usage events — the free tier's compliance record and the data
// flywheel.
//
// Every use of every listing is logged: which channel, which listing, when,
// and where. Organic rows are the proof that a free-with-attribution use
// happened under the blanket agreement; sponsored rows are the delivery
// record a paid placement is billed and judged against. Together they are the
// sales proof for the paid side ("this catalog gets used N times a month")
// and, later, the matching-quality signal.
//
// SAFE — the trust boundary, stated plainly:
//   * `reportedBy` is RECORDED, never inferred, and never defaulted to
//     'platform_api'. Platform APIs cannot currently confirm that a specific
//     video used a specific track, so a channel-reported row is legitimate —
//     but it must stay distinguishable from a platform-verified one, or the
//     whole table becomes self-reported numbers wearing a verified label.
//     This is the same rule as channel reach: do not launder a claim into a
//     fact by storing it in the same column.
//   * A caller can never report SPEND. `spend_usdc` is written only from what
//     `slots.accrue` actually moved against the slot's capped budget. A
//     channel claiming "$40 of impressions" gets $40 of impressions counted
//     and the money the cap allows — no more.
//   * Organic usage of a PAID listing is refused. Free-with-attribution is a
//     property of the supply, not a choice the consumer makes; allowing it
//     would let a channel take paid creative without paying.
//
// CLEAN: sponsored delivery is delegated to the slots service rather than
// re-implemented here, so the budget cap has exactly one enforcement point.

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  channels as channelsTable,
  listings as listingsTable,
  slots as slotsTable,
  usageEvents as usageTable,
} from '../lib/schema';
import { log } from '../lib/logger';
import type { SlotsService } from './slots';
import type { UsageKind, UsageReportedBy } from '../lib/types';

export type UsageFailureCode =
  | 'LISTING_NOT_FOUND'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_NOT_OWNED'
  | 'SLOT_REQUIRED'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_FOR_LISTING'
  | 'PAID_LISTING_NEEDS_SLOT'
  | 'SLOT_NOT_ACTIVE'
  | 'BUDGET_EXHAUSTED'
  | 'INVALID_IMPRESSIONS'
  | 'INVALID_VIDEO_URL';

export interface UsageRecord {
  id: string;
  listing_id: string;
  channel_id: string;
  slot_id: string | null;
  kind: UsageKind;
  attribution_code: string | null;
  video_url: string | null;
  external_content_id: string | null;
  impressions: number;
  clicks: number;
  spend_usdc: string;
  /**
   * Who told us this happened. Read this before trusting any aggregate built
   * on top of the table.
   */
  reported_by: UsageReportedBy;
  status: string;
  occurred_at: string;
  created_at: string;
}

export type UsageResult =
  | { ok: true; usage: UsageRecord }
  | { ok: false; code: UsageFailureCode; message: string };

export interface LogUsageInput {
  listingId: string;
  channelId: string;
  /** The wallet reporting. Must own the channel. */
  reporterWallet: string;
  /**
   * Required for a paid listing; forbidden to imply spend for a free one.
   * When omitted for a paid listing the caller must name the slot.
   */
  slotId?: string | null;
  /** Resolved from the slot when omitted. */
  attributionCode?: string | null;
  videoUrl?: string | null;
  externalContentId?: string | null;
  impressions?: number;
  clicks?: number;
  /**
   * How the reporter knows. Defaults to 'channel' — the honest default for a
   * self-serve report. Only the platform probe path may claim 'platform_api'.
   */
  reportedBy?: UsageReportedBy;
  occurredAt?: string | null;
}

export interface UsageSummary {
  total_events: number;
  total_impressions: number;
  total_clicks: number;
  organic_events: number;
  sponsored_events: number;
  /** Spend the table actually accounted for, in decimal USDC. */
  spend_usdc: string;
  distinct_channels: number;
  distinct_listings: number;
  /**
   * How much of the above came from the platform versus from a channel's own
   * report. An aggregate quoted without this split is a self-reported number.
   */
  by_reporter: Record<UsageReportedBy, number>;
}

export interface UsageService {
  log(input: LogUsageInput): Promise<UsageResult>;
  get(usageId: string): Promise<UsageRecord | null>;
  listForListing(listingId: string, opts?: { limit?: number; offset?: number }): Promise<UsageRecord[]>;
  listForChannel(channelId: string, opts?: { limit?: number }): Promise<UsageRecord[]>;
  listForSlot(slotId: string, opts?: { limit?: number }): Promise<UsageRecord[]>;
  /** The catalog-level rollup. Always carries its reporter split. */
  summary(opts?: { sinceIso?: string | null }): Promise<UsageSummary>;
  /**
   * Compliance check for one listing: how many uses were logged, and how many
   * of them were reported by someone other than the platform.
   */
  attributionCompliance(listingId: string): Promise<{
    logged: number;
    platform_verified: number;
    channel_reported: number;
    manual: number;
  }>;
}

type UsageRow = typeof usageTable.$inferSelect;

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function rowToUsage(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    listing_id: row.listingId,
    channel_id: row.channelId,
    slot_id: row.slotId,
    kind: row.kind,
    attribution_code: row.attributionCode,
    video_url: row.videoUrl,
    external_content_id: row.externalContentId,
    impressions: row.impressions,
    clicks: row.clicks,
    spend_usdc: row.spendUsdc,
    reported_by: row.reportedBy,
    status: row.status,
    occurred_at: row.occurredAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

function nonNegativeInt(value: number | undefined, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 0 ? n : null;
}

export function createUsageService(slots: SlotsService): UsageService {
  async function list(where: ReturnType<typeof eq>, limit: number, offset = 0): Promise<UsageRecord[]> {
    const rows = await db
      .select()
      .from(usageTable)
      .where(where)
      .orderBy(desc(usageTable.occurredAt), desc(usageTable.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(rowToUsage);
  }

  return {
    async log(input) {
      const reporter = input.reporterWallet.toLowerCase();
      const reportedBy: UsageReportedBy = input.reportedBy ?? 'channel';

      const impressions = nonNegativeInt(input.impressions, 1);
      const clicks = nonNegativeInt(input.clicks, 0);
      if (impressions === null || clicks === null) {
        return {
          ok: false,
          code: 'INVALID_IMPRESSIONS',
          message: 'Impressions and clicks must be non-negative whole numbers.',
        };
      }
      if (impressions === 0 && clicks === 0) {
        return {
          ok: false,
          code: 'INVALID_IMPRESSIONS',
          message: 'A usage event must report at least one impression or click.',
        };
      }
      const videoUrl = input.videoUrl?.trim() || null;
      if (videoUrl && videoUrl.length > 2000) {
        return { ok: false, code: 'INVALID_VIDEO_URL', message: 'Video URL is too long.' };
      }

      const [listing] = await db
        .select()
        .from(listingsTable)
        .where(eq(listingsTable.id, input.listingId))
        .limit(1);
      if (!listing) {
        return { ok: false, code: 'LISTING_NOT_FOUND', message: 'Listing not found.' };
      }

      const [channel] = await db
        .select()
        .from(channelsTable)
        .where(eq(channelsTable.id, input.channelId))
        .limit(1);
      // Another wallet's channel is missing, not forbidden: a channel's usage
      // history is not public.
      if (!channel || channel.ownerWallet.toLowerCase() !== reporter) {
        return { ok: false, code: 'CHANNEL_NOT_FOUND', message: 'Channel not found.' };
      }

      let slotId = input.slotId ?? null;
      let spendUsdc = '0';
      let attributionCode = input.attributionCode?.trim() || null;
      const kind: UsageKind = listing.tier === 'paid' ? 'sponsored' : 'organic';

      if (listing.tier === 'paid') {
        // Paid creative is only usable under a slot. Without one there is
        // nothing to bill and nothing that carries the disclosure.
        if (!slotId) {
          // Resolve the channel's most recent placement for this listing
          // regardless of status, and let `slots.accrue` deliver the verdict.
          // Filtering to 'active' here would tell an exhausted campaign that
          // it has no placement at all — false, and useless to a channel's
          // automation loop, which needs to know the budget is finished.
          const [latest] = await db
            .select()
            .from(slotsTable)
            .where(and(eq(slotsTable.listingId, listing.id), eq(slotsTable.channelId, channel.id)))
            .orderBy(desc(slotsTable.createdAt))
            .limit(1);
          if (!latest) {
            return {
              ok: false,
              code: 'PAID_LISTING_NEEDS_SLOT',
              message: 'This listing is paid supply. Buy a placement before reporting delivery against it.',
            };
          }
          slotId = latest.id;
        } else {
          // Validate BEFORE accruing. `slots.accrue` moves money against
          // whatever slot id it is given, so checking afterwards would let a
          // reporter spend another channel's escrow and only then be told no.
          const named = await slots.get(slotId);
          // Another channel's slot is reported missing, not forbidden.
          if (!named || named.channel_id !== channel.id) {
            return { ok: false, code: 'SLOT_NOT_FOUND', message: 'Placement not found.' };
          }
          if (named.listing_id !== listing.id) {
            return {
              ok: false,
              code: 'SLOT_NOT_FOR_LISTING',
              message: 'That placement was bought for a different listing.',
            };
          }
          attributionCode = attributionCode ?? named.attribution_code;
        }
        // Delegate the spend movement to the slots service. It owns the capped
        // atomic increment; logging a spend figure from the request body here
        // would let a reporter write money that was never collected.
        const accrued = await slots.accrue({ slotId, impressions, clicks });
        if (!accrued.ok) {
          const code: UsageFailureCode =
            accrued.code === 'SLOT_NOT_FOUND'
              ? 'SLOT_NOT_FOUND'
              : accrued.code === 'BUDGET_EXHAUSTED'
                ? 'BUDGET_EXHAUSTED'
                : 'SLOT_NOT_ACTIVE';
          return { ok: false, code, message: accrued.message };
        }
        spendUsdc = accrued.delta_usdc;
        attributionCode = attributionCode ?? accrued.slot.attribution_code;
      } else if (slotId) {
        // A slot is a purchase. Reporting free supply "under" one would attach
        // an organic use to a paid campaign's numbers.
        return {
          ok: false,
          code: 'SLOT_NOT_FOR_LISTING',
          message: 'This listing is free-with-attribution and cannot be reported against a paid placement.',
        };
      } else {
        // Organic attribution binds the listing's own credit to the content it
        // appeared in, which is what the blanket agreement obliges the channel
        // to render.
        attributionCode = attributionCode ?? listing.attributionSlug;
      }

      const now = new Date();
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
      const [row] = await db
        .insert(usageTable)
        .values({
          id: randomUUID(),
          listingId: listing.id,
          channelId: channel.id,
          slotId,
          kind,
          attributionCode,
          videoUrl,
          externalContentId: input.externalContentId?.trim() || null,
          impressions,
          clicks,
          spendUsdc,
          reportedBy,
          status: 'logged',
          occurredAt: Number.isNaN(occurredAt.getTime()) ? now : occurredAt,
          createdAt: now,
        })
        .returning();

      log.info('usage logged', {
        usage_id: row.id,
        listing_id: listing.id,
        channel_id: channel.id,
        kind,
        reported_by: reportedBy,
        impressions,
        spend_usdc: spendUsdc,
      });

      return { ok: true, usage: rowToUsage(row) };
    },

    async get(usageId) {
      const [row] = await db
        .select()
        .from(usageTable)
        .where(eq(usageTable.id, usageId))
        .limit(1);
      return row ? rowToUsage(row) : null;
    },

    async listForListing(listingId, { limit = 50, offset = 0 } = {}) {
      return list(eq(usageTable.listingId, listingId), limit, offset);
    },

    async listForChannel(channelId, { limit = 50 } = {}) {
      return list(eq(usageTable.channelId, channelId), limit);
    },

    async listForSlot(slotId, { limit = 50 } = {}) {
      return list(eq(usageTable.slotId, slotId), limit);
    },

    async summary({ sinceIso = null } = {}) {
      const since = sinceIso ? new Date(sinceIso) : null;
      const scoped = since && !Number.isNaN(since.getTime()) ? gte(usageTable.occurredAt, since) : undefined;

      const [totals] = await db
        .select({
          total_events: sql<number>`count(*)::int`,
          total_impressions: sql<number>`COALESCE(SUM(${usageTable.impressions}), 0)::int`,
          total_clicks: sql<number>`COALESCE(SUM(${usageTable.clicks}), 0)::int`,
          organic_events: sql<number>`count(*) FILTER (WHERE ${usageTable.kind} = 'organic')::int`,
          sponsored_events: sql<number>`count(*) FILTER (WHERE ${usageTable.kind} = 'sponsored')::int`,
          spend: sql<string | null>`COALESCE(SUM(CAST(${usageTable.spendUsdc} AS NUMERIC)), 0)::TEXT`,
          distinct_channels: sql<number>`count(DISTINCT ${usageTable.channelId})::int`,
          distinct_listings: sql<number>`count(DISTINCT ${usageTable.listingId})::int`,
        })
        .from(usageTable)
        .where(scoped);

      const byReporter = await db
        .select({
          reported_by: usageTable.reportedBy,
          count: sql<number>`count(*)::int`,
        })
        .from(usageTable)
        .where(scoped)
        .groupBy(usageTable.reportedBy);

      const byReporterMap: Record<UsageReportedBy, number> = {
        channel: 0,
        platform_api: 0,
        manual: 0,
      };
      for (const row of byReporter) {
        byReporterMap[row.reported_by] = row.count;
      }

      return {
        total_events: totals?.total_events ?? 0,
        total_impressions: totals?.total_impressions ?? 0,
        total_clicks: totals?.total_clicks ?? 0,
        organic_events: totals?.organic_events ?? 0,
        sponsored_events: totals?.sponsored_events ?? 0,
        spend_usdc: totals?.spend ?? '0',
        distinct_channels: totals?.distinct_channels ?? 0,
        distinct_listings: totals?.distinct_listings ?? 0,
        by_reporter: byReporterMap,
      };
    },

    async attributionCompliance(listingId) {
      const [row] = await db
        .select({
          logged: sql<number>`count(*)::int`,
          platform_verified: sql<number>`count(*) FILTER (WHERE ${usageTable.reportedBy} = 'platform_api')::int`,
          channel_reported: sql<number>`count(*) FILTER (WHERE ${usageTable.reportedBy} = 'channel')::int`,
          manual: sql<number>`count(*) FILTER (WHERE ${usageTable.reportedBy} = 'manual')::int`,
        })
        .from(usageTable)
        .where(eq(usageTable.listingId, listingId));
      return {
        logged: row?.logged ?? 0,
        platform_verified: row?.platform_verified ?? 0,
        channel_reported: row?.channel_reported ?? 0,
        manual: row?.manual ?? 0,
      };
    },
  };
}
