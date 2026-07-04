// MODULAR: A&R agent service. Autonomous playlist curation +
// agent-to-agent economics. The A&R agent browses the published
// feed, builds playlists, charges listeners per recommendation,
// and pays artists per play.

import { createHash, randomUUID } from 'crypto';
import { eq, sql, desc, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  arPlaylists as playlistsTable,
  arPlaylistTracks as playlistTracksTable,
  arPlayEvents as playEventsTable,
  publishedVersions as pvTable,
  submissions as submissionsTable,
} from '../lib/schema';
import { cached } from '../lib/cache';
import { emit } from '../lib/event-bus';
import type { ArcAdapter } from '../adapters/arc';

// MODULAR: short TTL + event-bus invalidation. Playlists change
// infrequently (only when the A&R agent generates fresh ones).
const PLAYLIST_CACHE_TTL_MS = 30_000;

export const LISTENER_FEE_USDC = '0.001';
export const ARTIST_PAYOUT_USDC = '0.0005';

export type PlayType = 'free' | 'paid';

function mockPlaylistName(genre: string, mood: string | null): string {
  const adjectives: Record<string, string[]> = {
    rock: ['Electric', 'Raw', 'Amplified', 'Heavy', 'Driving'],
    jazz: ['Smooth', 'Late Night', 'Improvised', 'Swinging', 'Cool'],
    electronic: ['Synthetic', 'Pulsing', 'Digital', 'Atmospheric', 'Glitch'],
    folk: ['Rooted', 'Acoustic', 'Earthy', 'Wandering', 'Intimate'],
    'hip-hop': ['Boom Bap', 'Lyrical', 'Underground', 'Trap', 'Lo-fi'],
    classical: ['Orchestral', 'Chamber', 'Solo', 'Baroque', 'Contemporary'],
    pop: ['Bright', 'Catchy', 'Polished', 'Anthemic', 'Dreamy'],
  };
  const adj = adjectives[genre] || adjectives.rock;
  const seed = createHash('md5').update(`${genre}:${mood}`).digest();
  return `${adj[seed[0] % adj.length]} ${mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Mix'} Sessions`;
}

function mockPlaylistDescription(genre: string, mood: string | null): string {
  return `A curated selection of ${genre} tracks with a ${mood || 'varied'} feel. ` +
    `The A&R agent selected these from the published catalog based on taste-graph ` +
    `compatibility, production quality, and listener engagement patterns.`;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  mood: string | null;
  ar_wallet: string;
  track_count: number;
  createdAt?: Date;
  updatedAt?: Date;
  tracks?: Array<{
    position: number;
    submission_id: string;
    title: string;
    artist_name: string;
    artist_wallet?: string;
    version_type: string;
    audio_path: string;
    avg_solo_intensity: number | null;
    avg_vocal_quality: number | null;
    energy_consensus: string | null;
    tempo_consensus: string | null;
    aggregated_mood_tags: string[] | null;
    published_at: Date;
  }>;
}

export interface PlaylistStats {
  total_plays: number;
  total_revenue_usdc: number;
  total_paid_to_artists_usdc: number;
  ar_margin_usdc: number;
}

export interface ArService {
  generatePlaylists: () => Promise<PlaylistSummary[]>;
  listPlaylists: () => Promise<PlaylistSummary[]>;
  getPlaylist: (playlistId: string) => Promise<PlaylistSummary | null>;
  recordPlay: (args: {
    playlistId: string;
    versionId: string;
    listenerWallet: string;
    playType?: PlayType;
  }) => Promise<
    | {
        ok: true;
        play: {
          id: string;
          playlist_id: string;
          version_id: string;
          listener_wallet: string;
          artist_wallet: string;
          listener_fee_usdc: string;
          artist_payout_usdc: string;
          listener_tx_hash: string | null;
          artist_tx_hash: string | null;
          status: 'settled' | 'failed';
          play_type: PlayType;
        };
      }
    | { ok: false; error: string }
  >;
  getPlaylistStats: (playlistId: string) => Promise<PlaylistStats>;
  listenerFee: string;
  artistPayout: string;
}

export function createArService({
  arc,
  arWallet,
}: {
  arc: ArcAdapter;
  arWallet: string;
}): ArService {
  return {
    listenerFee: LISTENER_FEE_USDC,
    artistPayout: ARTIST_PAYOUT_USDC,

    async generatePlaylists(): Promise<PlaylistSummary[]> {
      const published = await db.select().from(pvTable).orderBy(desc(pvTable.publishedAt));
      if (published.length === 0) return [];

      // PERFORMANT: collapse the per-version genre SELECT (N+1) into a
      // single batched fetch using inArray.
      const versionIds = published.map((v) => v.submissionId);
      const subRows = versionIds.length
        ? await db
            .select({ id: submissionsTable.id, genre: submissionsTable.genre })
            .from(submissionsTable)
            .where(inArray(submissionsTable.id, versionIds))
        : [];
      const genreBySubmission = new Map<string, string | null>();
      for (const r of subRows) {
        genreBySubmission.set(r.id, r.genre);
      }

      const playlists: PlaylistSummary[] = [];

      const byGenre = new Map<string, typeof published>();
      for (const v of published) {
        const genre = genreBySubmission.get(v.submissionId) ?? 'other';
        if (!byGenre.has(genre)) byGenre.set(genre, []);
        byGenre.get(genre)!.push(v);
      }

      for (const [genre, tracks] of byGenre) {
        const sorted = [...tracks].sort((a, b) => {
          const scoreA = (a.avgSoloIntensity ?? 0) + (a.avgVocalQuality ?? 0);
          const scoreB = (b.avgSoloIntensity ?? 0) + (b.avgVocalQuality ?? 0);
          return scoreB - scoreA;
        });

        const moodCounts = new Map<string, number>();
        for (const t of sorted) {
          const tags = Array.isArray(t.aggregatedMoodTags) ? t.aggregatedMoodTags : [];
          for (const tag of tags) {
            moodCounts.set(tag, (moodCounts.get(tag) || 0) + 1);
          }
        }
        const topMood =
          moodCounts.size > 0
            ? [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
            : null;

        const playlistId = randomUUID();
        const name = mockPlaylistName(genre, topMood);
        const description = mockPlaylistDescription(genre, topMood);

        await db.insert(playlistsTable).values({
          id: playlistId,
          name,
          description,
          genre,
          mood: topMood,
          arWallet,
          trackCount: 0,
        });

        const selected = sorted.slice(0, 10);
        if (selected.length > 0) {
          await db.insert(playlistTracksTable).values(
            selected.map((track, idx) => ({
              id: randomUUID(),
              playlistId,
              versionId: track.submissionId,
              position: idx + 1,
            })),
          );
        }
        await db
          .update(playlistsTable)
          .set({ trackCount: selected.length, updatedAt: new Date() })
          .where(eq(playlistsTable.id, playlistId));

        playlists.push({
          id: playlistId,
          name,
          description,
          genre,
          mood: topMood,
          ar_wallet: arWallet,
          track_count: selected.length,
        });
      }

      // MODULAR: invalidate any cached playlist list once the A&R agent
      // has finished writing fresh playlists into the catalog.
      emit('playlist-update', {
        type: 'generated',
        generated: playlists.length,
        timestamp: new Date().toISOString(),
      });

      return playlists;
    },

    // PERFORMANT (Phase 2): wrapped in TTL + event-bus cache. The cache
    // key is a single static string because listPlaylists has no args.
    listPlaylists(): Promise<PlaylistSummary[]> {
      return cached('playlists:list', PLAYLIST_CACHE_TTL_MS, async () => {
        const playlists = await db
          .select()
          .from(playlistsTable)
          .orderBy(desc(playlistsTable.updatedAt));
        if (playlists.length === 0) return [];

        // PERF: Batch-fetch all tracks for all playlists in a single query.
        const playlistIds = playlists.map((p) => p.id);
        const allTracks = await db
          .select({
            playlistId: playlistTracksTable.playlistId,
            position: playlistTracksTable.position,
            submission_id: pvTable.submissionId,
            title: pvTable.title,
            artist_name: pvTable.artistName,
            artist_wallet: pvTable.artistWallet,
            version_type: pvTable.versionType,
            audio_path: pvTable.audioPath,
            avg_solo_intensity: pvTable.avgSoloIntensity,
            avg_vocal_quality: pvTable.avgVocalQuality,
            energy_consensus: pvTable.energyConsensus,
            tempo_consensus: pvTable.tempoConsensus,
            aggregated_mood_tags: pvTable.aggregatedMoodTags,
            published_at: pvTable.publishedAt,
          })
          .from(playlistTracksTable)
          .innerJoin(pvTable, eq(pvTable.submissionId, playlistTracksTable.versionId))
          .where(inArray(playlistTracksTable.playlistId, playlistIds))
          .orderBy(playlistTracksTable.position);

        const tracksByPlaylist = new Map<string, typeof allTracks>();
        for (const track of allTracks) {
          const list = tracksByPlaylist.get(track.playlistId);
          if (list) {
            list.push(track);
          } else {
            tracksByPlaylist.set(track.playlistId, [track]);
          }
        }

        return playlists.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          genre: p.genre,
          mood: p.mood,
          ar_wallet: p.arWallet,
          track_count: p.trackCount,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          tracks: (tracksByPlaylist.get(p.id) || []).map((t) => ({
            position: t.position,
            submission_id: t.submission_id,
            title: t.title,
            artist_name: t.artist_name,
            artist_wallet: t.artist_wallet,
            version_type: t.version_type,
            audio_path: t.audio_path,
            avg_solo_intensity: t.avg_solo_intensity,
            avg_vocal_quality: t.avg_vocal_quality,
            energy_consensus: t.energy_consensus,
            tempo_consensus: t.tempo_consensus,
            aggregated_mood_tags: t.aggregated_mood_tags,
            published_at: t.published_at,
          })),
        }));
      }, ['playlist-update']);
    },

    async getPlaylist(playlistId: string): Promise<PlaylistSummary | null> {
      const [p] = await db
        .select()
        .from(playlistsTable)
        .where(eq(playlistsTable.id, playlistId))
        .limit(1);
      if (!p) return null;
      const tracks = await db
        .select({
          position: playlistTracksTable.position,
          submission_id: pvTable.submissionId,
          title: pvTable.title,
          artist_name: pvTable.artistName,
          artist_wallet: pvTable.artistWallet,
          version_type: pvTable.versionType,
          audio_path: pvTable.audioPath,
          avg_solo_intensity: pvTable.avgSoloIntensity,
          avg_vocal_quality: pvTable.avgVocalQuality,
          energy_consensus: pvTable.energyConsensus,
          tempo_consensus: pvTable.tempoConsensus,
          aggregated_mood_tags: pvTable.aggregatedMoodTags,
          published_at: pvTable.publishedAt,
        })
        .from(playlistTracksTable)
        .innerJoin(pvTable, eq(pvTable.submissionId, playlistTracksTable.versionId))
        .where(eq(playlistTracksTable.playlistId, playlistId))
        .orderBy(playlistTracksTable.position);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        genre: p.genre,
        mood: p.mood,
        ar_wallet: p.arWallet,
        track_count: p.trackCount,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        tracks,
      };
    },

    async recordPlay({ playlistId, versionId, listenerWallet, playType = 'paid' }) {
      const [playlist] = await db
        .select()
        .from(playlistsTable)
        .where(eq(playlistsTable.id, playlistId))
        .limit(1);
      if (!playlist) return { ok: false as const, error: 'Playlist not found' };

      const [version] = await db
        .select()
        .from(pvTable)
        .where(eq(pvTable.submissionId, versionId))
        .limit(1);
      if (!version) return { ok: false as const, error: 'Version not found' };

      const isFree = playType === 'free';
      const playId = randomUUID();
      await db.insert(playEventsTable).values({
        id: playId,
        playlistId,
        versionId,
        listenerWallet,
        artistWallet: version.artistWallet,
        listenerFeeUsdc: isFree ? '0' : LISTENER_FEE_USDC,
        artistPayoutUsdc: ARTIST_PAYOUT_USDC,
        playType,
        status: 'pending',
      });

      let listenerTx: string | null = null;
      let artistTx: string | null = null;

      // Free plays skip the listener charge — the platform subsidizes the artist payout.
      if (!isFree) {
        try {
          const listenerResult = await arc.sendTransfer({
            from: listenerWallet,
            to: arWallet,
            amountUsdc: LISTENER_FEE_USDC,
          });
          listenerTx = listenerResult.hash;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db
            .update(playEventsTable)
            .set({ status: 'failed' })
            .where(eq(playEventsTable.id, playId));
          return { ok: false as const, error: 'Listener payment failed: ' + msg };
        }
      }

      // Artist always gets paid (from AR wallet, regardless of play type)
      try {
        const artistResult = await arc.sendTransfer({
          from: arWallet,
          to: version.artistWallet,
          amountUsdc: ARTIST_PAYOUT_USDC,
        });
        artistTx = artistResult.hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(playEventsTable)
          .set({ status: 'failed' })
          .where(eq(playEventsTable.id, playId));
        return { ok: false as const, error: 'Artist payment failed: ' + msg };
      }

      await db
        .update(playEventsTable)
        .set({ listenerTxHash: listenerTx, artistTxHash: artistTx, status: 'settled' })
        .where(eq(playEventsTable.id, playId));

      return {
        ok: true as const,
        play: {
          id: playId,
          playlist_id: playlistId,
          version_id: versionId,
          listener_wallet: listenerWallet,
          artist_wallet: version.artistWallet,
          listener_fee_usdc: isFree ? '0' : LISTENER_FEE_USDC,
          artist_payout_usdc: ARTIST_PAYOUT_USDC,
          listener_tx_hash: listenerTx,
          artist_tx_hash: artistTx,
          status: 'settled' as const,
          play_type: playType,
        },
      };
    },

    async getPlaylistStats(playlistId: string): Promise<PlaylistStats> {
      const [row] = await db
        .select({
          c: sql<number>`COUNT(*)::int`,
          revenue: sql<string>`COALESCE(SUM(CAST(${playEventsTable.listenerFeeUsdc} AS NUMERIC)), 0)`,
          paid_out: sql<string>`COALESCE(SUM(CAST(${playEventsTable.artistPayoutUsdc} AS NUMERIC)), 0)`,
        })
        .from(playEventsTable)
        .where(sql`${playEventsTable.playlistId} = ${playlistId} AND ${playEventsTable.status} = 'settled'`);
      const revenue = Number(row?.revenue ?? 0);
      const paid = Number(row?.paid_out ?? 0);
      return {
        total_plays: Number(row?.c ?? 0),
        total_revenue_usdc: revenue,
        total_paid_to_artists_usdc: paid,
        ar_margin_usdc: revenue - paid,
      };
    },
  };
}
