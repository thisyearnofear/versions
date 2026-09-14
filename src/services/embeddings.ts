// MODULAR: Embedding service. Manages catalog embeddings for the
// supervisor inverse-search semantic layer.
//
// Writers: embedVersion (publish/backfill), embedAllPublished.
// Reader: feed.searchByBrief via pgvector cosine distance.
//
// OpenRouter mode embeds catalog *text* (title + brief fields), not raw
// audio — set EMBEDDING_API_URL for CLAP audio vectors.

import { db } from '../lib/db';
import {
  publishedVersions as pvTable,
  placementBriefs as briefsTable,
  submissions as submissionsTable,
  versionEmbeddings as embTable,
  listings as listingsTable,
  listingEmbeddings as listingEmbTable,
  channels as channelsTable,
  channelEmbeddings as channelEmbTable,
} from '../lib/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { createEmbeddingAdapter, type EmbeddingAdapter } from '../adapters/embedding';
import { buildCatalogEmbedText, buildChannelEmbedText, buildListingEmbedText } from '../lib/catalog-embed-text';
import { log } from '../lib/logger';

export interface EmbeddingService {
  embedVersion(submissionId: string): Promise<{ mock: boolean; dimensions: number }>;
  embedAllPublished(): Promise<{ embedded: number; skipped: number; mock: boolean }>;
  hasEmbeddings(): Promise<boolean>;
  // Marketplace: listings + channels share one vector space with brief search.
  embedListing(listingId: string): Promise<{ mock: boolean; dimensions: number }>;
  embedChannel(channelId: string): Promise<{ mock: boolean; dimensions: number }>;
  embedAllMarketplace(): Promise<{ listings: number; channels: number; skipped: number; mock: boolean }>;
}

export function createEmbeddingService(adapter?: EmbeddingAdapter): EmbeddingService {
  const emb = adapter || createEmbeddingAdapter();

  async function embedPublishedVersion(submissionId: string, audioPath: string) {
    if (emb.audioCapable) {
      return emb.embedAudio(audioPath);
    }

    const [row] = await db
      .select({
        title: pvTable.title,
        artistName: pvTable.artistName,
        versionType: pvTable.versionType,
        genre: submissionsTable.genre,
        aggregatedMoodTags: pvTable.aggregatedMoodTags,
      })
      .from(pvTable)
      .innerJoin(submissionsTable, eq(submissionsTable.id, pvTable.submissionId))
      .where(eq(pvTable.submissionId, submissionId))
      .limit(1);

    if (!row) {
      throw new Error(`embedVersion: published version not found: ${submissionId}`);
    }

    const [brief] = await db
      .select({
        sceneTags: briefsTable.sceneTags,
        instruments: briefsTable.instruments,
        emotionalArcs: briefsTable.emotionalArcs,
        audienceSummary: briefsTable.audienceSummary,
      })
      .from(briefsTable)
      .where(eq(briefsTable.submissionId, submissionId))
      .limit(1);

    const text = buildCatalogEmbedText(row, brief ?? null);
    return emb.embedText(text);
  }

  return {
    async embedVersion(submissionId: string) {
      const [version] = await db
        .select({ submissionId: pvTable.submissionId, audioPath: pvTable.audioPath })
        .from(pvTable)
        .where(eq(pvTable.submissionId, submissionId))
        .limit(1);

      if (!version) {
        throw new Error(`embedVersion: published version not found: ${submissionId}`);
      }

      const [existing] = await db
        .select({ submissionId: embTable.submissionId })
        .from(embTable)
        .where(eq(embTable.submissionId, submissionId))
        .limit(1);

      if (existing) {
        return { mock: emb.mock, dimensions: emb.dimensions };
      }

      const result = await embedPublishedVersion(submissionId, version.audioPath);

      await db.insert(embTable).values({
        submissionId,
        embedding: result.embedding,
        model: result.model,
      }).onConflictDoNothing();

      log.info('embedded version', {
        submissionId,
        mock: result.mock,
        model: result.model,
        dimensions: result.embedding.length,
        textOnly: !emb.audioCapable,
      });
      return { mock: result.mock, dimensions: result.embedding.length };
    },

    async embedAllPublished() {
      const missing = await db
        .select({ submissionId: pvTable.submissionId, audioPath: pvTable.audioPath })
        .from(pvTable)
        .leftJoin(embTable, eq(embTable.submissionId, pvTable.submissionId))
        .where(isNull(embTable.submissionId));

      let embedded = 0;
      let skipped = 0;

      for (const v of missing) {
        try {
          const result = await embedPublishedVersion(v.submissionId, v.audioPath);
          await db.insert(embTable).values({
            submissionId: v.submissionId,
            embedding: result.embedding,
            model: result.model,
          }).onConflictDoNothing();
          embedded++;
        } catch (err) {
          log.warn('backfill: failed to embed version', {
            submissionId: v.submissionId,
            error: (err as Error).message,
          });
          skipped++;
        }
      }

      log.info('backfill complete', { embedded, skipped, mock: emb.mock, textOnly: !emb.audioCapable });
      return { embedded, skipped, mock: emb.mock };
    },

    async hasEmbeddings() {
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(embTable);
      return count > 0;
    },

    async embedListing(listingId: string) {
      const [row] = await db
        .select({
          id: listingsTable.id,
          kind: listingsTable.kind,
          title: listingsTable.title,
          supplierName: listingsTable.supplierName,
          summary: listingsTable.summary,
          tags: listingsTable.tags,
          tier: listingsTable.tier,
        })
        .from(listingsTable)
        .where(eq(listingsTable.id, listingId))
        .limit(1);
      if (!row) throw new Error(`embedListing: listing not found: ${listingId}`);
      const [existing] = await db.select({ listingId: listingEmbTable.listingId }).from(listingEmbTable).where(eq(listingEmbTable.listingId, listingId)).limit(1);
      if (existing) return { mock: emb.mock, dimensions: emb.dimensions };
      const text = buildListingEmbedText({ kind: row.kind, title: row.title, supplierName: row.supplierName, summary: row.summary, tags: row.tags ?? [], tier: row.tier });
      const result = await emb.embedText(text);
      await db.insert(listingEmbTable).values({ listingId, embedding: result.embedding, model: result.model }).onConflictDoNothing();
      log.info('embedded listing', { listingId, mock: result.mock, model: result.model });
      return { mock: result.mock, dimensions: result.embedding.length };
    },

    async embedChannel(channelId: string) {
      const [row] = await db
        .select({
          id: channelsTable.id,
          name: channelsTable.name,
          niche: channelsTable.niche,
          ethosSummary: channelsTable.ethosSummary,
          platformDescription: channelsTable.platformDescription,
          recentContent: channelsTable.recentContent,
        })
        .from(channelsTable)
        .where(eq(channelsTable.id, channelId))
        .limit(1);
      if (!row) throw new Error(`embedChannel: channel not found: ${channelId}`);
      const [existing] = await db.select({ channelId: channelEmbTable.channelId }).from(channelEmbTable).where(eq(channelEmbTable.channelId, channelId)).limit(1);
      if (existing) return { mock: emb.mock, dimensions: emb.dimensions };
      const text = buildChannelEmbedText({ name: row.name, niche: row.niche, ethosSummary: row.ethosSummary, platformDescription: row.platformDescription, recentContent: row.recentContent ?? [] });
      const result = await emb.embedText(text);
      await db.insert(channelEmbTable).values({ channelId, embedding: result.embedding, model: result.model }).onConflictDoNothing();
      log.info('embedded channel', { channelId, mock: result.mock, model: result.model });
      return { mock: result.mock, dimensions: result.embedding.length };
    },

    async embedAllMarketplace() {
      let listings = 0;
      let channels = 0;
      let skipped = 0;
      const missingListings = await db
        .select({ id: listingsTable.id })
        .from(listingsTable)
        .leftJoin(listingEmbTable, eq(listingEmbTable.listingId, listingsTable.id))
        .where(isNull(listingEmbTable.listingId));
      for (const { id } of missingListings) {
        try {
          const [row] = await db.select({ kind: listingsTable.kind, title: listingsTable.title, supplierName: listingsTable.supplierName, summary: listingsTable.summary, tags: listingsTable.tags, tier: listingsTable.tier }).from(listingsTable).where(eq(listingsTable.id, id)).limit(1);
          if (!row) { skipped++; continue; }
          const text = buildListingEmbedText({ kind: row.kind, title: row.title, supplierName: row.supplierName, summary: row.summary, tags: row.tags ?? [], tier: row.tier });
          const result = await emb.embedText(text);
          await db.insert(listingEmbTable).values({ listingId: id, embedding: result.embedding, model: result.model }).onConflictDoNothing();
          listings++;
        } catch (err) { log.warn('marketplace backfill: listing failed', { id, error: (err as Error).message }); skipped++; }
      }
      const missingChannels = await db
        .select({ id: channelsTable.id })
        .from(channelsTable)
        .leftJoin(channelEmbTable, eq(channelEmbTable.channelId, channelsTable.id))
        .where(isNull(channelEmbTable.channelId));
      for (const { id } of missingChannels) {
        try {
          const [row] = await db.select({ name: channelsTable.name, niche: channelsTable.niche, ethosSummary: channelsTable.ethosSummary, platformDescription: channelsTable.platformDescription, recentContent: channelsTable.recentContent }).from(channelsTable).where(eq(channelsTable.id, id)).limit(1);
          if (!row) { skipped++; continue; }
          const text = buildChannelEmbedText({ name: row.name, niche: row.niche, ethosSummary: row.ethosSummary, platformDescription: row.platformDescription, recentContent: row.recentContent ?? [] });
          const result = await emb.embedText(text);
          await db.insert(channelEmbTable).values({ channelId: id, embedding: result.embedding, model: result.model }).onConflictDoNothing();
          channels++;
        } catch (err) { log.warn('marketplace backfill: channel failed', { id, error: (err as Error).message }); skipped++; }
      }
      log.info('marketplace backfill complete', { listings, channels, skipped, mock: emb.mock });
      return { listings, channels, skipped, mock: emb.mock };
    },
  };
}
