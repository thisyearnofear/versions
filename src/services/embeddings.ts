// MODULAR: Embedding service. Manages CLAP audio embeddings for the
// supervisor inverse-search semantic layer. Two entry points:
//   - embedVersion(submissionId): embed a single published version
//     (called at publish time or during backfill)
//   - embedAllPublished(): batch-backfill all published versions that
//     don't yet have an embedding row
//
// DRY: the only code path that writes to version_embeddings. The feed
//      service reads from it; this service is the sole writer.
// PERFORMANT: backfill processes sequentially to avoid overwhelming
//             the embedding API rate limit. A future PR can parallelize
//             with a bounded concurrency queue if the catalog grows.

import { db } from '../lib/db';
import { publishedVersions as pvTable, versionEmbeddings as embTable } from '../lib/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { createEmbeddingAdapter, type EmbeddingAdapter } from '../adapters/embedding';
import { log } from '../lib/logger';

export interface EmbeddingService {
  embedVersion(submissionId: string): Promise<{ mock: boolean; dimensions: number }>;
  embedAllPublished(): Promise<{ embedded: number; skipped: number; mock: boolean }>;
  hasEmbeddings(): Promise<boolean>;
}

export function createEmbeddingService(adapter?: EmbeddingAdapter): EmbeddingService {
  const emb = adapter || createEmbeddingAdapter();

  return {
    async embedVersion(submissionId: string) {
      // Fetch the published version to get the audio path.
      const [version] = await db
        .select({ submissionId: pvTable.submissionId, audioPath: pvTable.audioPath })
        .from(pvTable)
        .where(eq(pvTable.submissionId, submissionId))
        .limit(1);

      if (!version) {
        throw new Error(`embedVersion: published version not found: ${submissionId}`);
      }

      // Skip if already embedded (idempotent).
      const [existing] = await db
        .select({ submissionId: embTable.submissionId })
        .from(embTable)
        .where(eq(embTable.submissionId, submissionId))
        .limit(1);

      if (existing) {
        return { mock: emb.mock, dimensions: emb.dimensions };
      }

      const result = await emb.embedAudio(version.audioPath);

      await db.insert(embTable).values({
        submissionId,
        embedding: result.embedding,
        model: result.model,
      }).onConflictDoNothing();

      log.info('embedded version', { submissionId, mock: result.mock, model: result.model, dimensions: result.embedding.length });
      return { mock: result.mock, dimensions: result.embedding.length };
    },

    async embedAllPublished() {
      // Find all published versions without an embedding row.
      const missing = await db
        .select({ submissionId: pvTable.submissionId, audioPath: pvTable.audioPath })
        .from(pvTable)
        .leftJoin(embTable, eq(embTable.submissionId, pvTable.submissionId))
        .where(isNull(embTable.submissionId));

      let embedded = 0;
      let skipped = 0;

      for (const v of missing) {
        try {
          const result = await emb.embedAudio(v.audioPath);
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

      log.info('backfill complete', { embedded, skipped, mock: emb.mock });
      return { embedded, skipped, mock: emb.mock };
    },

    async hasEmbeddings() {
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(embTable);
      return count > 0;
    },
  };
}
