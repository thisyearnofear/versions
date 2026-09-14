// MODULAR: Channel onboarding and verification — the demand side of the
// marketplace. A channel is an AI-run distribution surface (YouTube
// automation, radio-style feeds) that picks listings out of the catalog and
// uses them.
//
// SAFE: the numbers on a channel row always come from the platform's own API.
// There is no code path here that accepts a subscriber or view count from a
// request body, and `StatsSource` has no 'self_reported' arm. Invented reach
// is the fraud that undermines ad marketplaces, so the gate is structural:
// `canBuySlots` is true only for a row whose verification_status is
// 'verified', which only a non-mock probe can set.
//
// PERFORMANT: mock-first like every adapter here. With no YOUTUBE_API_KEY the
// probe resolves deterministically from the URL, so onboarding, the demo and
// the tests all run offline — but the row lands at verification_status
// 'pending' with stats_source 'mock'. A mock probe can populate a demo
// channel; it can never unlock a paid slot.
//
// CLEAN: registration returns a discriminated result instead of throwing, so
// the route maps a failure code to an HTTP status without try/catch plumbing
// around DB and network calls alike.

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { channels as channelsTable, users as usersTable } from '../lib/schema';
import {
  ChannelUrlError,
  createChannelProbeAdapter,
  type ChannelProbeAdapter,
  type PlatformChannelProbe,
} from '../adapters/youtube';
import { isCurrentAgreementVersion } from '../lib/agreement';
import { log } from '../lib/logger';
import type {
  ChannelPlatform,
  ChannelStatus,
  ChannelVerification,
  StatsSource,
} from '../lib/types';

export interface ChannelStatsRecord {
  subscriber_count: number | null;
  view_count: string | null;
  video_count: number | null;
  /** 'platform_api' only when the numbers were pulled from the platform. */
  source: StatsSource | null;
  verified_at: string | null;
}

export interface ChannelRecord {
  id: string;
  owner_wallet: string;
  name: string;
  platform: ChannelPlatform;
  platform_url: string;
  platform_channel_id: string | null;
  verification_status: ChannelVerification;
  verification_error: string | null;
  stats: ChannelStatsRecord;
  niche: string | null;
  ethos_summary: string | null;
  /** Operator-typed profile text, kept separate from platform-pulled text. */
  recent_content: string[];
  agreement_version: string;
  status: ChannelStatus;
  created_at: string;
  updated_at: string;
  /**
   * The paid-tier gate. True only for a channel whose distribution numbers
   * were verified against the platform and which is not suspended. Everything
   * that sells a slot must check this rather than re-deriving it.
   */
  can_buy_slots: boolean;
}

export type ChannelFailureCode =
  | 'AGREEMENT_VERSION_STALE'
  | 'PLATFORM_UNSUPPORTED'
  | 'INVALID_PLATFORM_URL'
  | 'PROBE_FAILED'
  | 'CHANNEL_NOT_FOUND';

export type ChannelResult =
  | { ok: true; channel: ChannelRecord; alreadyRegistered: boolean }
  | { ok: false; code: ChannelFailureCode; message: string };

export interface RegisterChannelInput {
  ownerWallet: string;
  platformUrl: string;
  platform?: ChannelPlatform;
  /** Operator-stated niche, e.g. "lo-fi study streams". */
  niche?: string | null;
  /** Operator-stated ethos, in their own words. */
  ethosSummary?: string | null;
  /** Must equal the version the UI actually rendered. */
  agreementVersion: string;
}

export interface ChannelsService {
  register(input: RegisterChannelInput): Promise<ChannelResult>;
  /** Re-probe an existing channel. Turns a pending mock row into a verified one. */
  verify(channelId: string): Promise<ChannelResult>;
  get(channelId: string): Promise<ChannelRecord | null>;
  listForWallet(wallet: string, opts?: { limit?: number }): Promise<ChannelRecord[]>;
  /** The text embedded into channel_embeddings for ethos matching. */
  ethosText(channelId: string): Promise<string | null>;
}

type ChannelRow = typeof channelsTable.$inferSelect;

/**
 * The single place that decides whether a channel may buy a slot. Kept as a
 * named predicate so the money path and the UI read the same rule.
 */
export function canBuySlots(row: Pick<ChannelRow, 'verificationStatus' | 'status'>): boolean {
  return row.verificationStatus === 'verified' && row.status === 'active';
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toRecord(row: ChannelRow): ChannelRecord {
  return {
    id: row.id,
    owner_wallet: row.ownerWallet,
    name: row.name,
    platform: row.platform,
    platform_url: row.platformUrl,
    platform_channel_id: row.platformChannelId,
    verification_status: row.verificationStatus,
    verification_error: row.verificationError,
    stats: {
      subscriber_count: row.subscriberCount,
      view_count: row.viewCount,
      video_count: row.videoCount,
      source: row.statsSource,
      verified_at: toIso(row.statsVerifiedAt),
    },
    niche: row.niche,
    ethos_summary: row.ethosSummary,
    recent_content: row.recentContent ?? [],
    agreement_version: row.agreementVersion,
    status: row.status,
    created_at: toIso(row.createdAt) ?? '',
    updated_at: toIso(row.updatedAt) ?? '',
    can_buy_slots: canBuySlots(row),
  };
}

/**
 * Verification outcome for one probe. A mock probe records its numbers (so the
 * demo has a populated channel) but stays 'pending' and leaves verified_at
 * null — recording a verification time for invented numbers would make them
 * indistinguishable from real ones downstream.
 */
function verificationFor(probe: PlatformChannelProbe): {
  status: ChannelVerification;
  source: StatsSource;
  verifiedAt: Date | null;
} {
  if (probe.mock) {
    return { status: 'pending', source: 'mock', verifiedAt: null };
  }
  return { status: 'verified', source: 'platform_api', verifiedAt: new Date(probe.probedAt) };
}

/**
 * Ethos text for the embedding. Platform-pulled content carries more weight
 * than operator-typed prose precisely because it cannot be inflated: recent
 * upload titles describe what the channel actually publishes, which is what a
 * listing has to fit.
 */
export function buildChannelEthosText(row: {
  name: string;
  niche: string | null;
  ethosSummary: string | null;
  platformDescription: string | null;
  recentContent: string[];
}): string {
  const parts = [
    row.niche ? `niche: ${row.niche}` : '',
    row.ethosSummary ? `about: ${row.ethosSummary}` : '',
    row.platformDescription ? `channel: ${row.platformDescription}` : '',
    `name: ${row.name}`,
    ...row.recentContent.slice(0, 12).map((line) => `recent: ${line}`),
  ];
  return parts.filter(Boolean).join('\n');
}

export function createChannelsService(probe?: ChannelProbeAdapter): ChannelsService {
  const adapter = probe || createChannelProbeAdapter();

  async function ensureUser(wallet: string) {
    const now = new Date();
    await db
      .insert(usersTable)
      .values({
        id: randomUUID(),
        walletAddress: wallet.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: usersTable.walletAddress });
  }

  /**
   * One probe, mapped to a ChannelResult. Network and URL failures become
   * codes rather than exceptions so a caller never has to know which layer
   * broke.
   */
  async function runProbe(platformUrl: string): Promise<
    | { ok: true; probe: PlatformChannelProbe }
    | { ok: false; code: ChannelFailureCode; message: string }
  > {
    try {
      return { ok: true, probe: await adapter.probe(platformUrl) };
    } catch (err) {
      if (err instanceof ChannelUrlError) {
        return { ok: false, code: 'INVALID_PLATFORM_URL', message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      log.warn('channel probe failed', { platformUrl, err: message });
      return {
        ok: false,
        code: 'PROBE_FAILED',
        message: 'Could not reach the platform to verify this channel — try again shortly.',
      };
    }
  }

  async function fetchById(channelId: string): Promise<ChannelRow | null> {
    const [row] = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.id, channelId))
      .limit(1);
    return row ?? null;
  }

  const service: ChannelsService = {
    async register(input) {
      // The click-through is only valid against the version the UI rendered.
      // A stale client is rejected rather than silently upgraded, so the
      // stamped version always matches terms the acceptor actually saw.
      if (!isCurrentAgreementVersion(input.agreementVersion)) {
        return {
          ok: false,
          code: 'AGREEMENT_VERSION_STALE',
          message: 'The agreement has been updated — reload and accept the current terms.',
        };
      }

      const platform = input.platform ?? 'youtube';
      if (platform !== 'youtube') {
        // v1 verifies against YouTube only. Accepting an unverifiable surface
        // would mean trusting self-reported reach, which is the one thing this
        // module exists to prevent.
        return {
          ok: false,
          code: 'PLATFORM_UNSUPPORTED',
          message: 'Connect a YouTube channel — other platforms cannot be verified yet.',
        };
      }

      const probed = await runProbe(input.platformUrl);
      if (!probed.ok) return probed;
      const { probe } = probed;

      const ownerWallet = input.ownerWallet.toLowerCase();
      await ensureUser(ownerWallet);

      const now = new Date();
      const verification = verificationFor(probe);
      const id = randomUUID();
      const [inserted] = await db
        .insert(channelsTable)
        .values({
          id,
          ownerWallet,
          // The platform's own name for the channel, not an operator-typed
          // one — another field that cannot be inflated at registration.
          name: probe.name,
          platform,
          platformUrl: probe.platformUrl,
          platformChannelId: probe.platformChannelId,
          verificationStatus: verification.status,
          verificationError: verification.status === 'pending' && probe.mock
            ? 'Distribution numbers are placeholders — set YOUTUBE_API_KEY and re-verify.'
            : null,
          subscriberCount: probe.subscriberCount,
          viewCount: probe.viewCount,
          videoCount: probe.videoCount,
          statsSource: verification.source,
          statsVerifiedAt: verification.verifiedAt,
          niche: input.niche ?? null,
          ethosSummary: input.ethosSummary ?? null,
          platformDescription: probe.description || null,
          recentContent: probe.recentContent,
          agreementVersion: input.agreementVersion,
          agreementAcceptedAt: now,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        // One channel row per real distribution surface. A double-click or a
        // second wallet pasting the same URL lands here instead of creating a
        // duplicate that could be verified twice.
        .onConflictDoNothing({
          target: [channelsTable.platform, channelsTable.platformChannelId],
        })
        .returning();

      if (!inserted) {
        const [existing] = await db
          .select()
          .from(channelsTable)
          .where(
            and(
              eq(channelsTable.platform, platform),
              eq(channelsTable.platformChannelId, probe.platformChannelId),
            ),
          )
          .limit(1);
        if (!existing) {
          return {
            ok: false,
            code: 'PROBE_FAILED',
            message: 'That channel is already registered but could not be loaded.',
          };
        }
        return { ok: true, channel: toRecord(existing), alreadyRegistered: true };
      }

      log.info('channel registered', {
        channelId: id,
        platform,
        verification: verification.status,
        mock: probe.mock,
      });
      return { ok: true, channel: toRecord(inserted), alreadyRegistered: false };
    },

    async verify(channelId) {
      const row = await fetchById(channelId);
      if (!row) {
        return { ok: false, code: 'CHANNEL_NOT_FOUND', message: 'No channel with that id.' };
      }

      const probed = await runProbe(row.platformUrl);
      if (!probed.ok) {
        // A failed re-probe must not silently downgrade a verified channel:
        // keep the existing status and record why the attempt failed.
        await db
          .update(channelsTable)
          .set({ verificationError: probed.message, updatedAt: new Date() })
          .where(eq(channelsTable.id, channelId));
        return probed;
      }
      const { probe } = probed;
      const verification = verificationFor(probe);

      const [updated] = await db
        .update(channelsTable)
        .set({
          name: probe.name,
          platformUrl: probe.platformUrl,
          platformChannelId: probe.platformChannelId,
          verificationStatus: verification.status,
          verificationError:
            verification.status === 'verified'
              ? null
              : 'Distribution numbers are placeholders — set YOUTUBE_API_KEY and re-verify.',
          subscriberCount: probe.subscriberCount,
          viewCount: probe.viewCount,
          videoCount: probe.videoCount,
          statsSource: verification.source,
          statsVerifiedAt: verification.verifiedAt,
          platformDescription: probe.description || null,
          recentContent: probe.recentContent,
          updatedAt: new Date(),
        })
        .where(eq(channelsTable.id, channelId))
        .returning();

      log.info('channel verified', {
        channelId,
        status: verification.status,
        mock: probe.mock,
        subscribers: probe.subscriberCount,
      });
      return { ok: true, channel: toRecord(updated ?? row), alreadyRegistered: true };
    },

    async get(channelId) {
      const row = await fetchById(channelId);
      return row ? toRecord(row) : null;
    },

    async listForWallet(wallet, { limit = 50 } = {}) {
      const rows = await db
        .select()
        .from(channelsTable)
        .where(eq(channelsTable.ownerWallet, wallet.toLowerCase()))
        .orderBy(desc(channelsTable.createdAt))
        .limit(Math.min(Math.max(1, limit), 100));
      return rows.map(toRecord);
    },

    async ethosText(channelId) {
      const row = await fetchById(channelId);
      return row ? buildChannelEthosText(row) : null;
    },
  };

  return service;
}
